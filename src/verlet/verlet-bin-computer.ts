import { computeShaderSource } from './shader-source';

import applyForcesShaderCode from './shaders/apply-forces.wgsl';
import collideShaderCode from './shaders/collide.wgsl';
import collideIncrementShaderCode from './shaders/collideIncrement.wgsl';
import constrainShaderCode from './shaders/constrain.wgsl';
import integrateShaderCode from './shaders/integrate.wgsl';

import binClearShaderCode from './shaders/bin-clear.wgsl';
import binLinkClearShaderCode from './shaders/bin-link-clear.wgsl';
import binSetShaderCode from './shaders/bin-set.wgsl';

const shaders = {
  binClear: binClearShaderCode,
  binLinkClear: binLinkClearShaderCode,
  binSet: binSetShaderCode,
  applyForces: applyForcesShaderCode,
  collide: collideShaderCode,
  collideIncrement: collideIncrementShaderCode,
  constrain: constrainShaderCode,
  integrate: integrateShaderCode
};

type Stage = keyof typeof shaders;

export interface BinGrid {
  /** Side of one square bin, in simulation units. */
  binSize: number;
  width: number;
  height: number;
  binCount: number;
}

/**
 * Sizes the grid of bins covering a square of side `bounds`. Width and height
 * are forced even because collision processes every second bin per pass.
 */
export function binGrid(bounds: number, binSize: number): BinGrid {
  // The shaders hold the bin size as an integer.
  const size = Math.ceil(binSize);
  const width = Math.ceil(bounds / size / 2) * 2;
  const height = width;
  return { binSize: size, width, height, binCount: width * height };
}

/**
 * Times the stages of a substep with timestamp queries, for the benchmark.
 * Nothing in the simulation needs one; without it a substep is encoded as usual.
 */
export interface StageTimer {
  /** The timestamp writes for the compute pass that runs `stage`. */
  timestampWrites(stage: string): GPUComputePassTimestampWrites;
}

export interface BinComputerOptions {
  /** Side of the square area the bins cover, centred on the origin. */
  bounds: number;
  /** At least the diameter of the largest particle. */
  binSize: number;
  particleCount: number;
  particleBuffer: GPUBuffer;
  /** The simulation params uniform (the Params struct in common.wgsl). */
  paramsBuffer: GPUBuffer;
}

/**
 * The compute side of the simulation: encodes one substep as a fixed sequence
 * of compute dispatches. Internal to Verlet; tests reach it only to inspect
 * the binning stage on its own.
 */
export class VerletBinComputer {
  readonly grid: BinGrid;
  readonly binBuffer: GPUBuffer;

  private particleCount: number;
  private pipelines: Record<Stage, GPUComputePipeline>;
  private bindGroups: GPUBindGroup[];
  private binParamsBuffer: GPUBuffer;
  private csoBuffer: GPUBuffer;

  constructor(device: GPUDevice, options: BinComputerOptions) {
    this.particleCount = options.particleCount;
    this.grid = binGrid(options.bounds, options.binSize);

    const uniform = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'uniform' }
    });
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' }
    });

    const groupLayouts = [
      device.createBindGroupLayout({ entries: [uniform(1)] }), // @group(0): params
      device.createBindGroupLayout({ entries: [uniform(0)] }), // @group(1): binParams
      // @group(2): verletObjects, bins, cso
      device.createBindGroupLayout({ entries: [storage(0), storage(1), storage(2)] })
    ];
    const layout = device.createPipelineLayout({ bindGroupLayouts: groupLayouts });

    this.pipelines = {} as Record<Stage, GPUComputePipeline>;
    for (const stage of Object.keys(shaders) as Stage[]) {
      this.pipelines[stage] = device.createComputePipeline({
        label: stage,
        layout,
        compute: {
          module: device.createShaderModule({ code: computeShaderSource(shaders[stage]) }),
          entryPoint: 'main'
        }
      });
    }

    const { binSize, width, height, binCount } = this.grid;
    this.binParamsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(this.binParamsBuffer, 0, new Uint32Array([binSize, width, height, binCount]));

    // Collision step offset: which of the four interleaved sets of bins the
    // next collide pass covers. collideIncrement advances it on the GPU.
    this.csoBuffer = device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // One i32 per bin: the index of the first particle in its list, or -1.
    this.binBuffer = device.createBuffer({
      size: binCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    this.bindGroups = [
      device.createBindGroup({
        layout: groupLayouts[0],
        entries: [{ binding: 1, resource: { buffer: options.paramsBuffer } }]
      }),
      device.createBindGroup({
        layout: groupLayouts[1],
        entries: [{ binding: 0, resource: { buffer: this.binParamsBuffer } }]
      }),
      device.createBindGroup({
        layout: groupLayouts[2],
        entries: [
          { binding: 0, resource: { buffer: options.particleBuffer } },
          { binding: 1, resource: { buffer: this.binBuffer } },
          { binding: 2, resource: { buffer: this.csoBuffer } }
        ]
      })
    ];
  }

  /**
   * Encodes one substep. Without a timer it is a single compute pass; with one,
   * each stage gets a pass of its own carrying the timer's timestamp writes.
   */
  encodeSubstep(encoder: GPUCommandEncoder, collide: boolean, timer?: StageTimer) {
    const perParticle = Math.ceil(this.particleCount / 64);
    const stages: [string, (pass: GPUComputePassEncoder) => void][] = [];

    if (collide) {
      stages.push(['binning', (pass) => this.dispatchBinning(pass)]);
    }

    stages.push([
      'apply forces',
      (pass) => {
        pass.setPipeline(this.pipelines.applyForces);
        pass.dispatchWorkgroups(perParticle);
      }
    ]);

    if (collide) {
      stages.push([
        'collide',
        (pass) => {
          // A collide pass moves particles in the 3x3 bins around each bin it
          // visits, so it visits only every second bin in x and y. Four passes,
          // with collideIncrement shifting the offset between them, cover all bins.
          const x = Math.ceil(this.grid.width / 2 / 16);
          const y = Math.ceil(this.grid.height / 2 / 16);
          for (let i = 0; i < 4; i++) {
            pass.setPipeline(this.pipelines.collide);
            pass.dispatchWorkgroups(x, y);

            pass.setPipeline(this.pipelines.collideIncrement);
            pass.dispatchWorkgroups(1);
          }
        }
      ]);
    }

    stages.push([
      'constrain',
      (pass) => {
        pass.setPipeline(this.pipelines.constrain);
        pass.dispatchWorkgroups(perParticle);
      }
    ]);

    stages.push([
      'integrate',
      (pass) => {
        pass.setPipeline(this.pipelines.integrate);
        pass.dispatchWorkgroups(perParticle);
      }
    ]);

    if (!timer) {
      const pass = this.beginPass(encoder);
      for (const [, dispatch] of stages) dispatch(pass);
      pass.end();
      return;
    }
    for (const [stage, dispatch] of stages) {
      const pass = this.beginPass(encoder, timer.timestampWrites(stage));
      dispatch(pass);
      pass.end();
    }
  }

  /** Encodes only the binning stage, leaving the bin lists in the buffers. */
  encodeBinning(encoder: GPUCommandEncoder) {
    const pass = this.beginPass(encoder);
    this.dispatchBinning(pass);
    pass.end();
  }

  private beginPass(
    encoder: GPUCommandEncoder,
    timestampWrites?: GPUComputePassTimestampWrites
  ): GPUComputePassEncoder {
    const pass = encoder.beginComputePass({ timestampWrites });
    this.bindGroups.forEach((group, i) => pass.setBindGroup(i, group));
    return pass;
  }

  private dispatchBinning(pass: GPUComputePassEncoder) {
    const perParticle = Math.ceil(this.particleCount / 64);

    pass.setPipeline(this.pipelines.binClear);
    pass.dispatchWorkgroups(Math.ceil(this.grid.binCount / 64));

    pass.setPipeline(this.pipelines.binLinkClear);
    pass.dispatchWorkgroups(perParticle);

    pass.setPipeline(this.pipelines.binSet);
    pass.dispatchWorkgroups(perParticle);
  }

  destroy() {
    this.binParamsBuffer.destroy();
    this.csoBuffer.destroy();
    this.binBuffer.destroy();
  }
}
