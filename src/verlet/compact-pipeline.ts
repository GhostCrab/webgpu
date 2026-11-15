import { readBuffer } from '../read-buffer';
import { BinGrid, BinGridSize } from './bin-grid';
import {
  compactInstanceLayout,
  packCompactParticles,
  Particle,
  unpackCompactParticles,
  unpackCompactParticlesInPlace
} from './particle-layout';
import type { Pipeline, PipelineOptions } from './pipeline';
import { computeShaderSource } from './shader-source';
import type { StageTimer } from './verlet-bin-computer';
import collideShaderCode from './shaders/compact-collide.wgsl';
import constrainShaderCode from './shaders/compact-constrain.wgsl';
import integrateShaderCode from './shaders/compact-integrate.wgsl';
import velocityShaderCode from './shaders/compact-velocity.wgsl';
import vertexShader from './shaders/compact-renderer.wgsl';
import { VerletRenderer } from './verlet-renderer';

const shaders = {
  integrate: integrateShaderCode,
  collide: collideShaderCode,
  constrain: constrainShaderCode,
  velocity: velocityShaderCode
};

type Stage = keyof typeof shaders;

/** What a bin grid build left behind, for tests of the build on its own. */
export interface BinGridContents {
  grid: BinGridSize;
  /** The particles in the order they sit in the particle buffer. */
  particles: Particle[];
  /** Where each bin's run of particles starts, then the number of particles. */
  binStarts: Uint32Array;
}

function largestRadius(particles: Particle[]): number {
  return particles.reduce((largest, p) => Math.max(largest, p.radius), 0);
}

/**
 * The new pipeline (spec #9), being built beside the current one: the compact
 * particle with an explicit velocity, and its colour in a buffer of its own.
 * Every substep builds the bin grid, which leaves the particles in bin order in
 * the other of two particle buffers, then the collision solve writes them
 * back to the first.
 */
export class CompactPipeline implements Pipeline {
  private device: GPUDevice;
  private particleCount: number;
  /**
   * Two particle buffers: each build reads the particles from one and writes
   * them in bin order to the other, which then holds the particles.
   */
  private particleBuffers: [GPUBuffer, GPUBuffer];
  /** Which of the particle buffers holds the particles. */
  private current: 0 | 1 = 0;
  /** One colour per particle, at its particle id. Only drawing reads it. */
  private colorBuffer: GPUBuffer;
  /**
   * Per particle, at its place in the buffer holding the particles: the change
   * of velocity the collision solve found its impacts call for.
   */
  private impactBuffer: GPUBuffer;
  private binGrid: BinGrid;
  private pipelines: Record<Stage, GPUComputePipeline>;
  private paramsGroup: GPUBindGroup;
  /** Per buffer holding the particles: it at binding 0, the other at binding 1. */
  private particleGroups: [GPUBindGroup, GPUBindGroup];
  private renderer: VerletRenderer;

  constructor(device: GPUDevice, options: PipelineOptions) {
    this.device = device;
    this.particleCount = options.particles.length;

    const { particleData, colorData } = packCompactParticles(options.particles);
    const particleBuffer = () =>
      device.createBuffer({
        size: particleData.byteLength,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.VERTEX |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC
      });
    this.particleBuffers = [particleBuffer(), particleBuffer()];
    this.colorBuffer = device.createBuffer({
      size: colorData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    this.impactBuffer = device.createBuffer({
      size: Math.max(this.particleCount * 8, 8),
      usage: GPUBufferUsage.STORAGE
    });
    device.queue.writeBuffer(this.particleBuffers[0], 0, particleData);
    device.queue.writeBuffer(this.colorBuffer, 0, colorData);

    try {
      // The groups common.wgsl declares: params at group 0, binding 1, and the
      // bin grid at group 1. The particles are group 2.
      const paramsLayout = device.createBindGroupLayout({
        entries: [{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }]
      });
      const particlesLayout = device.createBindGroupLayout({
        entries: [0, 1, 2].map((binding) => ({
          binding,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' as const }
        }))
      });

      this.binGrid = new BinGrid(device, {
        bounds: options.bounds,
        minBinSize: options.minBinSize,
        largestRadius: largestRadius(options.particles),
        particleCount: this.particleCount,
        paramsLayout,
        particlesLayout
      });

      const layout = device.createPipelineLayout({
        bindGroupLayouts: [paramsLayout, this.binGrid.layout, particlesLayout]
      });
      this.pipelines = {} as Record<Stage, GPUComputePipeline>;
      for (const stage of Object.keys(shaders) as Stage[]) {
        this.pipelines[stage] = device.createComputePipeline({
          label: `new pipeline: ${stage}`,
          layout,
          compute: {
            module: device.createShaderModule({ code: computeShaderSource(shaders[stage]) }),
            entryPoint: 'main'
          }
        });
      }

      this.paramsGroup = device.createBindGroup({
        layout: paramsLayout,
        entries: [{ binding: 1, resource: { buffer: options.paramsBuffer } }]
      });
      const particleGroup = (from: GPUBuffer, to: GPUBuffer) =>
        device.createBindGroup({
          layout: particlesLayout,
          entries: [
            { binding: 0, resource: { buffer: from } },
            { binding: 1, resource: { buffer: to } },
            { binding: 2, resource: { buffer: this.impactBuffer } }
          ]
        });
      const [a, b] = this.particleBuffers;
      this.particleGroups = [particleGroup(a, b), particleGroup(b, a)];

      this.renderer = new VerletRenderer(device, {
        projection: options.projection,
        target: options.target,
        vertexShader,
        instanceLayout: compactInstanceLayout(2, 3, 4),
        colorBuffer: this.colorBuffer
      });
    } catch (error) {
      // Nothing outside holds a reference yet, so release what was created.
      this.particleBuffers.forEach((buffer) => buffer.destroy());
      this.colorBuffer.destroy();
      this.impactBuffer.destroy();
      this.binGrid?.destroy();
      throw error;
    }
  }

  /** The buffer that holds the particles. */
  private get particleBuffer(): GPUBuffer {
    return this.particleBuffers[this.current];
  }

  write(particles: Particle[]) {
    const { particleData, colorData } = packCompactParticles(particles);
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);
    this.device.queue.writeBuffer(this.colorBuffer, 0, colorData);
    this.binGrid.resize(largestRadius(particles));
  }

  /**
   * Encodes one substep: a single compute pass, or with a timer one pass per
   * stage. The stages run in the order spec #9 fixes: integrate, build the bin
   * grid, solve collisions, the boundary, then the velocity update. With
   * `collide` off the solve and the velocity update are skipped; the bin grid
   * is still built.
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
    const [particles, colors, binStarts] = await Promise.all([
      readBuffer(this.device, this.particleBuffer),
      readBuffer(this.device, this.colorBuffer),
      this.binGrid.readStarts()
    ]);
    return { grid, particles: unpackCompactParticlesInPlace(particles, colors), binStarts };
  }

  /**
   * The stages of a build. The last swaps which buffer holds the particles as
   * it is encoded, so every stage encoded after it reads them in bin order.
   */
  private binGridStages(): [string, (pass: GPUComputePassEncoder) => void][] {
    const stages = this.binGrid.stages({
      params: this.paramsGroup,
      particles: this.particleGroups[this.current]
    });
    const [name, place] = stages[stages.length - 1];
    stages[stages.length - 1] = [
      name,
      (pass) => {
        place(pass);
        this.current = this.current === 0 ? 1 : 0;
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
        pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
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
        this.current = this.current === 0 ? 1 : 0;
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

  async read(): Promise<Particle[]> {
    const [particles, colors] = await Promise.all([
      readBuffer(this.device, this.particleBuffer),
      readBuffer(this.device, this.colorBuffer)
    ]);
    return unpackCompactParticles(particles, colors);
  }

  draw(pass: GPURenderPassEncoder) {
    this.renderer.render(pass, this.particleBuffer, this.particleCount);
  }

  destroy() {
    this.particleBuffers.forEach((buffer) => buffer.destroy());
    this.colorBuffer.destroy();
    this.impactBuffer.destroy();
    this.binGrid.destroy();
    this.renderer.destroy();
  }
}
