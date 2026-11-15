import { readBuffer } from '../read-buffer';
import {
  compactInstanceLayout,
  packCompactParticles,
  Particle,
  unpackCompactParticles
} from './particle-layout';
import type { Pipeline, PipelineOptions } from './pipeline';
import { computeShaderSource } from './shader-source';
import constrainShaderCode from './shaders/compact-constrain.wgsl';
import integrateShaderCode from './shaders/compact-integrate.wgsl';
import vertexShader from './shaders/compact-renderer.wgsl';
import { VerletRenderer } from './verlet-renderer';

const shaders = {
  integrate: integrateShaderCode,
  constrain: constrainShaderCode
};

type Stage = keyof typeof shaders;

/**
 * The new pipeline (spec #9), being built beside the current one: the compact
 * particle with an explicit velocity, and its colour in a buffer of its own.
 * It has no collisions yet.
 */
export class CompactPipeline implements Pipeline {
  private device: GPUDevice;
  private particleCount: number;
  private particleBuffer: GPUBuffer;
  /** One colour per particle, at its particle id. Only drawing reads it. */
  private colorBuffer: GPUBuffer;
  private pipelines: Record<Stage, GPUComputePipeline>;
  private bindGroups: GPUBindGroup[];
  private renderer: VerletRenderer;

  constructor(device: GPUDevice, options: PipelineOptions) {
    this.device = device;
    this.particleCount = options.particles.length;

    const { particleData, colorData } = packCompactParticles(options.particles);
    this.particleBuffer = device.createBuffer({
      size: particleData.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC
    });
    this.colorBuffer = device.createBuffer({
      size: colorData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    device.queue.writeBuffer(this.particleBuffer, 0, particleData);
    device.queue.writeBuffer(this.colorBuffer, 0, colorData);

    try {
      // The groups common.wgsl declares: params at group 0, binding 1, and
      // group 1, which the bin grid (#16) will use. The particles are group 2.
      const groupLayouts = [
        device.createBindGroupLayout({
          entries: [{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }]
        }),
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }]
        })
      ];
      const layout = device.createPipelineLayout({ bindGroupLayouts: groupLayouts });

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

      this.bindGroups = [
        device.createBindGroup({
          layout: groupLayouts[0],
          entries: [{ binding: 1, resource: { buffer: options.paramsBuffer } }]
        }),
        device.createBindGroup({ layout: groupLayouts[1], entries: [] }),
        device.createBindGroup({
          layout: groupLayouts[2],
          entries: [{ binding: 0, resource: { buffer: this.particleBuffer } }]
        })
      ];

      this.renderer = new VerletRenderer(device, {
        projection: options.projection,
        target: options.target,
        vertexShader,
        instanceLayout: compactInstanceLayout(2, 3, 4),
        colorBuffer: this.colorBuffer
      });
    } catch (error) {
      // Nothing outside holds a reference yet, so release what was created.
      this.particleBuffer.destroy();
      this.colorBuffer.destroy();
      throw error;
    }
  }

  write(particles: Particle[]) {
    const { particleData, colorData } = packCompactParticles(particles);
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);
    this.device.queue.writeBuffer(this.colorBuffer, 0, colorData);
  }

  /**
   * Encodes one substep as a single compute pass. The stages run in the order
   * spec #9 fixes: integrate, build the bin grid (#16), solve collisions
   * (#17), the boundary, then the velocity update (#17).
   */
  encodeSubstep(encoder: GPUCommandEncoder) {
    const pass = encoder.beginComputePass();
    this.bindGroups.forEach((group, i) => pass.setBindGroup(i, group));
    const perParticle = Math.ceil(this.particleCount / 64);

    pass.setPipeline(this.pipelines.integrate);
    pass.dispatchWorkgroups(perParticle);

    pass.setPipeline(this.pipelines.constrain);
    pass.dispatchWorkgroups(perParticle);

    pass.end();
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
    this.particleBuffer.destroy();
    this.colorBuffer.destroy();
    this.renderer.destroy();
  }
}
