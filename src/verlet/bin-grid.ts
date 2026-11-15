import { readBuffer } from '../read-buffer';
import { BIN_GRID_PARAMS_BYTES, packBinGridParams } from './particle-layout';
import { computeShaderSource } from './shader-source';
import buildShaderCode from './shaders/compact-bin-grid.wgsl';
import scanShaderCode from './shaders/compact-scan.wgsl';

/** The new pipeline's bin grid: a dense grid of square bins over simulation space. */
export interface BinGridSize {
  /** Side of one square bin, in simulation units. */
  binSize: number;
  width: number;
  height: number;
  binCount: number;
}

export interface BinGridSizing {
  /** Side of the square region of simulation space the grid covers, centred on the origin. */
  bounds: number;
  /** The largest radius among the particles in use. */
  largestRadius: number;
  /** The smallest bin size configured; the bin buffers are allocated for it. */
  minBinSize: number;
}

/**
 * Sizes the bin grid from the radii in use. A bin is one diameter of the
 * largest particle wide, so every particle that can touch another lies in the
 * 3x3 bins around it, but never smaller than the configured minimum.
 */
export function sizeBinGrid({ bounds, largestRadius, minBinSize }: BinGridSizing): BinGridSize {
  const binSize = Math.max(2 * largestRadius, minBinSize);
  const width = Math.ceil(bounds / binSize);
  return { binSize, width, height: width, binCount: width * width };
}

// Values one workgroup of the scan covers; SCAN_BLOCK in compact-scan.wgsl.
const SCAN_BLOCK = 256;
// Workgroups per dispatch dimension, the WebGPU default limit.
const MAX_WORKGROUPS = 65535;
/** The most bins the grid can have: every bin-wide dispatch fits in one dimension. */
export const MAX_BINS = MAX_WORKGROUPS * SCAN_BLOCK - 1;
// Storage bindings must start at a multiple of this (the WebGPU default limit).
const OFFSET_ALIGNMENT = 256;

/**
 * The number of values at each level of the blocked scan over `count` values:
 * the values, their block totals, the totals' block totals, and so on, down to
 * a single total.
 */
function scanLevels(count: number): number[] {
  const levels = [count];
  while (levels[levels.length - 1] > 1) {
    levels.push(Math.ceil(levels[levels.length - 1] / SCAN_BLOCK));
  }
  return levels;
}

/** Where each level of block totals above the first sits in the block sums buffer, in bytes. */
function blockSumOffsets(levels: number[]): { offsets: number[]; bytes: number } {
  const offsets: number[] = [];
  let bytes = 0;
  for (const count of levels.slice(1)) {
    offsets.push(bytes);
    bytes += Math.ceil((count * 4) / OFFSET_ALIGNMENT) * OFFSET_ALIGNMENT;
  }
  return { offsets, bytes };
}

const buildStages = ['clearBins', 'countBins', 'writeKeys', 'placeParticles'] as const;
type BuildStage = (typeof buildStages)[number];

export interface BinGridOptions {
  /** Side of the square region of simulation space the grid covers, centred on the origin. */
  bounds: number;
  /** The smallest bin size configured; the bin buffers are allocated for it. */
  minBinSize: number;
  /** The largest radius among the starting particles. */
  largestRadius: number;
  particleCount: number;
  /** Bind group layout 0: the simulation params uniform. */
  paramsLayout: GPUBindGroupLayout;
  /** Bind group layout 2: the particles (binding 0) and the buffer they are sorted into (1). */
  particlesLayout: GPUBindGroupLayout;
}

/** The bind groups a build runs with. */
export interface BuildGroups {
  params: GPUBindGroup;
  /** The particles at binding 0, sorted into the buffer at binding 1. */
  particles: GPUBindGroup;
}

/**
 * The new pipeline's bin grid, built by counting sort every substep (ADR-0003).
 * A build writes the particles into a second buffer in bin order, so each bin's
 * particles are one contiguous run, in particle id order (ADR-0001).
 *
 * Its bind group (group 1) holds the bin grid uniform (binding 1) and the bin
 * starts (binding 2): bin `b`'s particles are those from `binStarts[b]` up to
 * `binStarts[b + 1]`.
 */
export class BinGrid {
  /** Bind group layout 1, for any stage that reads the bin grid. */
  readonly layout: GPUBindGroupLayout;
  readonly bindGroup: GPUBindGroup;

  private device: GPUDevice;
  private bounds: number;
  private minBinSize: number;
  private particleCount: number;
  private grid: BinGridSize;

  private paramsBuffer: GPUBuffer;
  private startsBuffer: GPUBuffer;
  private slotsBuffer: GPUBuffer;
  private keysBuffer: GPUBuffer;
  private blockSumsBuffer: GPUBuffer;

  private pipelines: Record<BuildStage, GPUComputePipeline>;
  private scanLayout: GPUBindGroupLayout;
  private scanPipelines: { scanBlocks: GPUComputePipeline; addBlockSums: GPUComputePipeline };
  /** Per level of the scan but the last: its values and their block totals. */
  private scanGroups: GPUBindGroup[] = [];
  private levels: number[] = [];

  constructor(device: GPUDevice, options: BinGridOptions) {
    const { bounds, minBinSize, particleCount } = options;
    if (!(minBinSize > 0) || !Number.isFinite(minBinSize)) {
      throw new Error(`the smallest bin size must be a positive number; got ${minBinSize}`);
    }
    const allocated = sizeBinGrid({ bounds, largestRadius: 0, minBinSize });
    if (allocated.binCount > MAX_BINS) {
      throw new Error(
        `the smallest bin size, ${minBinSize}, gives ${allocated.binCount} bins over bounds ` +
          `of ${bounds}; at most ${MAX_BINS} are supported`
      );
    }

    this.device = device;
    this.bounds = bounds;
    this.minBinSize = minBinSize;
    this.particleCount = particleCount;

    const storage = (size: number, usage = 0) =>
      device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | usage });
    this.paramsBuffer = device.createBuffer({
      size: BIN_GRID_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    // One more than the bins, for the end of the last bin's run.
    this.startsBuffer = storage((allocated.binCount + 1) * 4, GPUBufferUsage.COPY_SRC);
    this.slotsBuffer = storage(particleCount * 4);
    this.keysBuffer = storage(particleCount * 4);
    this.blockSumsBuffer = storage(blockSumOffsets(scanLevels(allocated.binCount + 1)).bytes);

    try {
      const entry = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type }
      });
      this.layout = device.createBindGroupLayout({
        entries: [entry(1, 'uniform'), entry(2, 'storage'), entry(3, 'storage'), entry(4, 'storage')]
      });
      this.bindGroup = device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 1, resource: { buffer: this.paramsBuffer } },
          { binding: 2, resource: { buffer: this.startsBuffer } },
          { binding: 3, resource: { buffer: this.slotsBuffer } },
          { binding: 4, resource: { buffer: this.keysBuffer } }
        ]
      });

      const buildLayout = device.createPipelineLayout({
        bindGroupLayouts: [options.paramsLayout, this.layout, options.particlesLayout]
      });
      const buildModule = device.createShaderModule({ code: computeShaderSource(buildShaderCode) });
      this.pipelines = {} as Record<BuildStage, GPUComputePipeline>;
      for (const stage of buildStages) {
        this.pipelines[stage] = device.createComputePipeline({
          label: `bin grid: ${stage}`,
          layout: buildLayout,
          compute: { module: buildModule, entryPoint: stage }
        });
      }

      // The scan binds its values and block totals at group 0, so it never
      // binds the bin starts twice in one dispatch.
      this.scanLayout = device.createBindGroupLayout({
        entries: [entry(2, 'storage'), entry(3, 'storage')]
      });
      const scanPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.scanLayout] });
      const scanModule = device.createShaderModule({ code: computeShaderSource(scanShaderCode) });
      const scanPipeline = (entryPoint: string) =>
        device.createComputePipeline({
          label: `bin grid scan: ${entryPoint}`,
          layout: scanPipelineLayout,
          compute: { module: scanModule, entryPoint }
        });
      this.scanPipelines = {
        scanBlocks: scanPipeline('scanBlocks'),
        addBlockSums: scanPipeline('addBlockSums')
      };
    } catch (error) {
      this.destroy();
      throw error;
    }

    this.grid = allocated;
    this.resize(options.largestRadius);
  }

  /** The grid's current size. */
  get size(): BinGridSize {
    return this.grid;
  }

  /** Sizes the bins for the largest radius in use. */
  resize(largestRadius: number) {
    this.grid = sizeBinGrid({ bounds: this.bounds, largestRadius, minBinSize: this.minBinSize });
    this.device.queue.writeBuffer(this.paramsBuffer, 0, packBinGridParams(this.grid));

    this.levels = scanLevels(this.grid.binCount + 1);
    const { offsets } = blockSumOffsets(this.levels);
    const region = (level: number): GPUBufferBinding =>
      level === 0
        ? { buffer: this.startsBuffer, size: this.levels[0] * 4 }
        : { buffer: this.blockSumsBuffer, offset: offsets[level - 1], size: this.levels[level] * 4 };
    this.scanGroups = this.levels.slice(0, -1).map((_, level) =>
      this.device.createBindGroup({
        layout: this.scanLayout,
        entries: [
          { binding: 2, resource: region(level) },
          { binding: 3, resource: region(level + 1) }
        ]
      })
    );
  }

  /**
   * The build, as named stages for timing. Each encodes its dispatches into a
   * compute pass and sets the bind groups they use. After the last, the
   * particles sit in bin order in the buffer at binding 1 of `groups.particles`.
   */
  stages(groups: BuildGroups): [string, (pass: GPUComputePassEncoder) => void][] {
    const perParticle = Math.ceil(this.particleCount / 64);
    const perBin = Math.ceil((this.grid.binCount + 1) / 256);
    const run = (pass: GPUComputePassEncoder, stage: BuildStage, workgroups: number) => {
      pass.setPipeline(this.pipelines[stage]);
      pass.setBindGroup(0, groups.params);
      pass.setBindGroup(1, this.bindGroup);
      pass.setBindGroup(2, groups.particles);
      pass.dispatchWorkgroups(workgroups);
    };
    return [
      [
        'bin count',
        (pass) => {
          run(pass, 'clearBins', perBin);
          run(pass, 'countBins', perParticle);
        }
      ],
      ['bin scan', (pass) => this.encodeScan(pass)],
      [
        'bin place',
        (pass) => {
          run(pass, 'writeKeys', perParticle);
          run(pass, 'placeParticles', perParticle);
        }
      ]
    ];
  }

  /** Turns the bin counts into bin starts: a blocked exclusive prefix sum. */
  private encodeScan(pass: GPUComputePassEncoder) {
    const blocks = (level: number) => Math.ceil(this.levels[level] / SCAN_BLOCK);
    // Scan each level in blocks, writing the block totals to the level above.
    pass.setPipeline(this.scanPipelines.scanBlocks);
    this.scanGroups.forEach((group, level) => {
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(blocks(level));
    });
    // The top level fitted in one block, so it is complete. Add each level's
    // scanned totals back into the level below, top down.
    pass.setPipeline(this.scanPipelines.addBlockSums);
    for (let level = this.scanGroups.length - 2; level >= 0; level--) {
      pass.setBindGroup(0, this.scanGroups[level]);
      pass.dispatchWorkgroups(blocks(level));
    }
  }

  /** Reads the bin starts back: one per bin, then the number of particles. */
  async readStarts(): Promise<Uint32Array> {
    const starts = new Uint32Array(await readBuffer(this.device, this.startsBuffer));
    return starts.slice(0, this.grid.binCount + 1);
  }

  destroy() {
    this.paramsBuffer.destroy();
    this.startsBuffer.destroy();
    this.slotsBuffer.destroy();
    this.keysBuffer.destroy();
    this.blockSumsBuffer.destroy();
  }
}
