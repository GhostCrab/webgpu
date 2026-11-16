import { QUAD_INDEX_COUNT } from '../quad';
import { readBuffer } from '../read-buffer';
import { BinGrid, BinGridSize } from './bin-grid';
import {
  COLOR_BYTES,
  EDIT_BYTES,
  LIVE_DISPATCH_OFFSET,
  LIVE_DRAW_OFFSET,
  LIVE_PARTICLES_BYTES,
  packEdit,
  packLiveParticles,
  packParticles,
  Particle,
  PARTICLE_BYTES,
  unpackLiveCount,
  unpackParticles,
  unpackParticlesInPlace
} from './particle-layout';
import { computeShaderSource } from './shader-source';
import collideShaderCode from './shaders/collide.wgsl';
import constrainShaderCode from './shaders/constrain.wgsl';
import editShaderCode from './shaders/edit.wgsl';
import integrateShaderCode from './shaders/integrate.wgsl';
import velocityShaderCode from './shaders/velocity.wgsl';
import { VerletRenderer } from './verlet-renderer';

const shaders = {
  integrate: integrateShaderCode,
  collide: collideShaderCode,
  constrain: constrainShaderCode,
  velocity: velocityShaderCode
};

type Stage = keyof typeof shaders;

/**
 * Times the stages of a substep with timestamp queries, for the benchmark.
 * Nothing in the simulation needs one; without it a substep is encoded as usual.
 */
export interface StageTimer {
  /** The timestamp writes for the compute pass that runs `stage`. */
  timestampWrites(stage: string): GPUComputePassTimestampWrites;
}

export interface SimulationPipelineOptions {
  /** The starting particles; their ids run from 0 in the order given. */
  particles: Particle[];
  /**
   * The most particles the pipeline holds. Its per-particle buffers are
   * allocated for this many, once.
   */
  capacity: number;
  /** Side of the square region of simulation space that particles may occupy. */
  bounds: number;
  /**
   * The smallest bin size configured. The bin buffers are allocated for it,
   * and bins are sized from the radii in use, never smaller.
   */
  minBinSize: number;
  /** The simulation params uniform (the Params struct in common.wgsl). */
  paramsBuffer: GPUBuffer;
  /** Format of the canvas the particles are drawn to. */
  format: GPUTextureFormat;
}

function largestRadiusOf(particles: Particle[]): number {
  return particles.reduce((largest, p) => Math.max(largest, p.radius), 0);
}

/** What a bin grid build left behind, for tests of the build on its own. */
export interface BinGridContents {
  grid: BinGridSize;
  /** The particles in the order they sit in the particle buffer. */
  particles: Particle[];
  /** Where each bin's run of particles starts, then the number of particles. */
  binStarts: Uint32Array;
}


type Pair = 0 | 1;
const other = (pair: Pair): Pair => (pair === 0 ? 1 : 0);

/**
 * Owns the particles on the GPU and the passes that advance and draw them.
 * Internal to Verlet. A particle holds an explicit velocity, and its colour is
 * in a buffer of its own. Every substep builds the bin grid, which leaves the
 * particles in bin order in the other of two particle buffers, then the
 * collision solve writes them back to the first.
 *
 * The live particles sit at the start of the buffer holding them. Their count
 * is kept on the GPU, in the live particles buffer, and every per-particle
 * dispatch and the draw are sized from it indirectly; the CPU never waits to
 * learn it.
 */
export class SimulationPipeline {
  private device: GPUDevice;
  private capacity: number;
  /** The largest radius spawned or seeded since the last seeding, which sizes the bins. */
  private largestRadius = 0;
  /**
   * Two particle buffers: each build reads the particles from one and writes
   * them in bin order to the other, which then holds the particles.
   */
  private particleBuffers: [GPUBuffer, GPUBuffer];
  /** Which of the particle buffers holds the particles. */
  private current: Pair = 0;
  /**
   * Two colour buffers. The one holding the colours has each particle's colour
   * at the same place as the particle; each build moves the colours to the
   * other with the particles. Only drawing reads them.
   */
  private colorBuffers: [GPUBuffer, GPUBuffer];
  /** Which of the colour buffers holds the colours. */
  private currentColors: Pair = 0;
  /** The live particles (LiveParticles in common.wgsl). */
  private liveBuffer: GPUBuffer;
  /** What the latest spawn or erase asks of the GPU (Edit in common.wgsl). */
  private editBuffer: GPUBuffer;
  /** How many particles the latest erase marked. */
  private erasedBuffer: GPUBuffer;
  private editGroup: GPUBindGroup;
  private editPipelines: { erase: GPUComputePipeline; append: GPUComputePipeline };
  /** Readbacks of erase counts not yet mapped, destroyed with the pipeline. */
  private pendingReadbacks = new Set<GPUBuffer>();
  /**
   * Per particle, at its place in the buffer holding the particles: the change
   * of velocity the collision solve found its impacts call for.
   */
  private impactBuffer: GPUBuffer;
  private binGrid: BinGrid;
  private pipelines: Record<Stage, GPUComputePipeline>;
  private paramsGroup: GPUBindGroup;
  /**
   * Per buffer holding the particles: it at binding 0, the other at binding 1,
   * and the impacts at binding 2. For every stage but a build, spawn and erase.
   */
  private particleGroups: [GPUBindGroup, GPUBindGroup];
  /**
   * Per buffer holding the particles, then per buffer holding the colours: the
   * particles at binding 0 and the other particle buffer at binding 1, the
   * colours at binding 3 and the other colour buffer at binding 4. For a
   * build, spawn and erase.
   */
  private sortGroups: [[GPUBindGroup, GPUBindGroup], [GPUBindGroup, GPUBindGroup]];
  private renderer: VerletRenderer;

  constructor(device: GPUDevice, options: SimulationPipelineOptions) {
    this.device = device;
    const { capacity } = options;
    this.capacity = capacity;

    const particleBuffer = () =>
      device.createBuffer({
        size: capacity * PARTICLE_BYTES,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.VERTEX |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC
      });
    this.particleBuffers = [particleBuffer(), particleBuffer()];
    const colorBuffer = () =>
      device.createBuffer({
        size: capacity * COLOR_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
    this.colorBuffers = [colorBuffer(), colorBuffer()];
    this.impactBuffer = device.createBuffer({
      size: capacity * 8,
      usage: GPUBufferUsage.STORAGE
    });
    this.liveBuffer = device.createBuffer({
      size: LIVE_PARTICLES_BYTES,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC
    });
    this.editBuffer = device.createBuffer({
      size: EDIT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.erasedBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    try {
      // The groups common.wgsl declares: params at group 0, binding 1, and the
      // bin grid at group 1. The particles are group 2.
      const paramsLayout = device.createBindGroupLayout({
        entries: [{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }]
      });
      const storage = (binding: number): GPUBindGroupLayoutEntry => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' }
      });
      const particlesLayout = device.createBindGroupLayout({ entries: [0, 1, 2].map(storage) });
      const sortLayout = device.createBindGroupLayout({ entries: [0, 1, 3, 4].map(storage) });

      this.binGrid = new BinGrid(device, {
        bounds: options.bounds,
        minBinSize: options.minBinSize,
        largestRadius: largestRadiusOf(options.particles),
        capacity,
        live: this.liveBuffer,
        edit: this.editBuffer,
        paramsLayout,
        sortLayout
      });

      const layout = device.createPipelineLayout({
        bindGroupLayouts: [paramsLayout, this.binGrid.layout, particlesLayout]
      });
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

      const editLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          storage(1)
        ]
      });
      const editPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [paramsLayout, this.binGrid.layout, sortLayout, editLayout]
      });
      const editModule = device.createShaderModule({ code: computeShaderSource(editShaderCode) });
      const editPipeline = (entryPoint: string) =>
        device.createComputePipeline({
          label: entryPoint,
          layout: editPipelineLayout,
          compute: { module: editModule, entryPoint }
        });
      this.editPipelines = { erase: editPipeline('erase'), append: editPipeline('append') };
      this.editGroup = device.createBindGroup({
        layout: editLayout,
        entries: [
          { binding: 0, resource: { buffer: this.editBuffer } },
          { binding: 1, resource: { buffer: this.erasedBuffer } }
        ]
      });

      this.paramsGroup = device.createBindGroup({
        layout: paramsLayout,
        entries: [{ binding: 1, resource: { buffer: options.paramsBuffer } }]
      });
      const particleGroup = (particles: Pair) =>
        device.createBindGroup({
          layout: particlesLayout,
          entries: [
            { binding: 0, resource: { buffer: this.particleBuffers[particles] } },
            { binding: 1, resource: { buffer: this.particleBuffers[other(particles)] } },
            { binding: 2, resource: { buffer: this.impactBuffer } }
          ]
        });
      this.particleGroups = [particleGroup(0), particleGroup(1)];
      const sortGroup = (particles: Pair, colors: Pair) =>
        device.createBindGroup({
          layout: sortLayout,
          entries: [
            { binding: 0, resource: { buffer: this.particleBuffers[particles] } },
            { binding: 1, resource: { buffer: this.particleBuffers[other(particles)] } },
            { binding: 3, resource: { buffer: this.colorBuffers[colors] } },
            { binding: 4, resource: { buffer: this.colorBuffers[other(colors)] } }
          ]
        });
      this.sortGroups = [
        [sortGroup(0, 0), sortGroup(0, 1)],
        [sortGroup(1, 0), sortGroup(1, 1)]
      ];

      this.renderer = new VerletRenderer(device, {
        format: options.format,
        colorBuffers: this.colorBuffers
      });
    } catch (error) {
      // Nothing outside holds a reference yet, so release what was created.
      this.destroyBuffers();
      this.binGrid?.destroy();
      throw error;
    }

    this.write(options.particles);
  }

  /** The buffer that holds the particles. */
  private get particleBuffer(): GPUBuffer {
    return this.particleBuffers[this.current];
  }

  /** The sort group for the buffers holding the particles and their colours. */
  private get sortGroup(): GPUBindGroup {
    return this.sortGroups[this.current][this.currentColors];
  }

  /**
   * Replaces every particle, and sizes the bins for the largest radius among
   * them. There must be no more particles than the capacity.
   */
  write(particles: Particle[]) {
    const { particleData, colorData } = packParticles(particles);
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);
    this.device.queue.writeBuffer(this.colorBuffers[this.currentColors], 0, colorData);
    this.device.queue.writeBuffer(
      this.liveBuffer,
      0,
      packLiveParticles(particles.length, QUAD_INDEX_COUNT)
    );
    this.largestRadius = largestRadiusOf(particles);
    this.binGrid.resize(this.largestRadius);
  }

  /**
   * Adds particles after the live ones, wherever the live ones end, and sizes
   * the bins for the largest radius spawned. Particles beyond the capacity are
   * dropped on the GPU, but the caller should never send them. It submits its
   * own work and takes effect at once, so call it between submitted encoders,
   * never between encoding a substep and submitting it.
   */
  append(particles: Particle[]) {
    if (particles.length === 0) return;
    // The other buffers are free between substeps, so they stage the particles.
    const { particleData, colorData } = packParticles(particles);
    this.device.queue.writeBuffer(this.particleBuffers[other(this.current)], 0, particleData);
    this.device.queue.writeBuffer(this.colorBuffers[other(this.currentColors)], 0, colorData);
    this.writeEdit({ added: particles.length });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    this.setEditGroups(pass, this.editPipelines.append);
    pass.dispatchWorkgroups(Math.ceil(particles.length / 64));
    this.binGrid.encodeGrow(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.largestRadius = Math.max(this.largestRadius, largestRadiusOf(particles));
    this.binGrid.resize(this.largestRadius);
  }

  /**
   * Marks the live particles whose centres are within `radius` of `center`
   * erased; the next bin grid build leaves them out. It submits its own work
   * and takes effect at once, so call it between submitted encoders. Resolves
   * with how many it marked, once that has been read back; nothing waits for
   * it.
   */
  erase(center: [number, number], radius: number): Promise<number> {
    this.writeEdit({ center, radius });
    this.device.queue.writeBuffer(this.erasedBuffer, 0, new Uint32Array([0]));

    const readback = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    this.pendingReadbacks.add(readback);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    this.setEditGroups(pass, this.editPipelines.erase);
    pass.dispatchWorkgroupsIndirect(this.liveBuffer, LIVE_DISPATCH_OFFSET);
    pass.end();
    encoder.copyBufferToBuffer(this.erasedBuffer, 0, readback, 0, 4);
    this.device.queue.submit([encoder.finish()]);

    const release = () => {
      this.pendingReadbacks.delete(readback);
      readback.destroy();
    };
    return readback.mapAsync(GPUMapMode.READ).then(
      () => {
        const erased = new Uint32Array(readback.getMappedRange())[0];
        release();
        return erased;
      },
      (error) => {
        release();
        throw error;
      }
    );
  }

  private writeEdit(values: { center?: [number, number]; radius?: number; added?: number }) {
    this.device.queue.writeBuffer(
      this.editBuffer,
      0,
      packEdit({ center: [0, 0], radius: 0, added: 0, ...values, capacity: this.capacity })
    );
  }

  private setEditGroups(pass: GPUComputePassEncoder, pipeline: GPUComputePipeline) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.paramsGroup);
    pass.setBindGroup(1, this.binGrid.bindGroup);
    pass.setBindGroup(2, this.sortGroup);
    pass.setBindGroup(3, this.editGroup);
  }

  /**
   * Encodes one substep, reading the simulation params uniform: a single
   * compute pass, or with a timer one pass per stage carrying the timer's
   * timestamp writes. The stages run in the order spec #9 fixes: integrate,
   * build the bin grid, solve collisions, the boundary, then the velocity
   * update. With `collide` off the solve and the velocity update are skipped;
   * the bin grid is still built.
   */
  encodeSubstep(encoder: GPUCommandEncoder, collide: boolean, timer?: StageTimer) {
    this.encodeStages(encoder, [
      this.particleStage('integrate'),
      ...this.binGridStages(),
      ...(collide ? [this.solveStage()] : []),
      this.particleStage('constrain'),
      ...(collide ? [this.particleStage('velocity')] : [])
    ], timer);
  }

  /** Encodes only a bin grid build, for tests of the build on its own. */
  encodeBinGridBuild(encoder: GPUCommandEncoder) {
    this.encodeStages(encoder, this.binGridStages());
  }

  /** What the latest bin grid build left behind, for tests of the build on its own. */
  async readBinGrid(): Promise<BinGridContents> {
    const grid = this.binGrid.size;
    const [{ particles, colors, count }, binStarts] = await Promise.all([
      this.readContents(),
      this.binGrid.readStarts()
    ]);
    return { grid, particles: unpackParticlesInPlace(particles, colors, count), binStarts };
  }

  /**
   * The stages of a build. The last swaps which buffers hold the particles and
   * their colours as it is encoded, so every stage encoded after it reads them
   * in bin order.
   */
  private binGridStages(): [string, (pass: GPUComputePassEncoder) => void][] {
    // Stages are encoded in order, so the group is chosen when the build is encoded.
    const stages = this.binGrid.stages({ params: this.paramsGroup, particles: this.sortGroup });
    const [name, place] = stages[stages.length - 1];
    stages[stages.length - 1] = [
      name,
      (pass) => {
        place(pass);
        this.current = other(this.current);
        this.currentColors = other(this.currentColors);
      }
    ];
    return stages;
  }

  /** A stage that runs once per particle, on the buffer holding them when it is encoded. */
  private particleStage(stage: Stage): [string, (pass: GPUComputePassEncoder) => void] {
    return [
      stage,
      (pass) => {
        pass.setPipeline(this.pipelines[stage]);
        pass.setBindGroup(0, this.paramsGroup);
        pass.setBindGroup(1, this.binGrid.bindGroup);
        pass.setBindGroup(2, this.particleGroups[this.current]);
        pass.dispatchWorkgroupsIndirect(this.liveBuffer, LIVE_DISPATCH_OFFSET);
      }
    ];
  }

  /**
   * The collision solve. It reads the particles in bin order and writes them
   * to the other buffer, so it swaps which buffer holds them as it is encoded.
   */
  private solveStage(): [string, (pass: GPUComputePassEncoder) => void] {
    const [name, solve] = this.particleStage('collide');
    return [
      name,
      (pass) => {
        solve(pass);
        this.current = other(this.current);
      }
    ];
  }

  private encodeStages(
    encoder: GPUCommandEncoder,
    stages: [string, (pass: GPUComputePassEncoder) => void][],
    timer?: StageTimer
  ) {
    if (!timer) {
      const pass = encoder.beginComputePass();
      for (const [, dispatch] of stages) dispatch(pass);
      pass.end();
      return;
    }
    for (const [stage, dispatch] of stages) {
      const pass = encoder.beginComputePass({ timestampWrites: timer.timestampWrites(stage) });
      dispatch(pass);
      pass.end();
    }
  }

  /** Reads the live particles back, ordered by particle id. */
  async read(): Promise<Particle[]> {
    const { particles, colors, count } = await this.readContents();
    return unpackParticles(particles, colors, count);
  }

  /** The contents of the buffers holding the particles and their colours, and the live count. */
  private async readContents() {
    const [particles, colors, live] = await Promise.all([
      readBuffer(this.device, this.particleBuffer),
      readBuffer(this.device, this.colorBuffers[this.currentColors]),
      readBuffer(this.device, this.liveBuffer)
    ]);
    return { particles, colors, count: unpackLiveCount(live) };
  }

  /** Clears `view` and draws the particles into it, through `projection`. */
  draw(encoder: GPUCommandEncoder, view: GPUTextureView, projection: Float32Array<ArrayBuffer>) {
    this.renderer.render(encoder, view, projection, {
      particles: this.particleBuffer,
      colors: this.currentColors,
      live: this.liveBuffer,
      drawOffset: LIVE_DRAW_OFFSET
    });
  }

  private destroyBuffers() {
    this.particleBuffers.forEach((buffer) => buffer.destroy());
    this.colorBuffers.forEach((buffer) => buffer.destroy());
    this.impactBuffer.destroy();
    this.liveBuffer.destroy();
    this.editBuffer.destroy();
    this.erasedBuffer.destroy();
    this.pendingReadbacks.forEach((buffer) => buffer.destroy());
  }

  destroy() {
    this.destroyBuffers();
    this.binGrid.destroy();
    this.renderer.destroy();
  }
}
