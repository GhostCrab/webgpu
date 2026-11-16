import { Quad } from '../quad';
import { particleInstanceLayout } from './particle-layout';
import shaderCode from './shaders/particle-disc.wgsl';

export interface VerletRendererOptions {
  /** Format of the canvas the particles are drawn to. */
  format: GPUTextureFormat;
  /**
   * The two colour buffers, one paired with each particle buffer: each holds
   * every particle's colour at the same place as the particle.
   */
  colorBuffers: [GPUBuffer, GPUBuffer];
}

/** What to draw: the particles, their colours, and how many are live. */
export interface DrawnParticles {
  particles: GPUBuffer;
  /** Which of the colour buffers holds their colours. */
  colors: 0 | 1;
  /** Indirect indexed draw arguments at `drawOffset`, one instance per live particle. */
  live: GPUBuffer;
  drawOffset: number;
}

/**
 * Draws particles as instanced quads cut to discs, straight to the canvas.
 * Internal to Verlet.
 */
export class VerletRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  /** Per colour buffer. */
  private bindGroups: [GPUBindGroup, GPUBindGroup];
  private projectionBuffer: GPUBuffer;
  private quad: Quad;

  constructor(device: GPUDevice, options: VerletRendererOptions) {
    this.device = device;
    this.quad = new Quad(device);

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
      ]
    });

    this.projectionBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroup = (colorBuffer: GPUBuffer) =>
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.projectionBuffer } },
          { binding: 1, resource: { buffer: colorBuffer } }
        ]
      });
    this.bindGroups = [bindGroup(options.colorBuffers[0]), bindGroup(options.colorBuffers[1])];

    const shaderModule = device.createShaderModule({ code: shaderCode });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertex_main',
        buffers: [
          // quad buffer layout takes locations 0 - 1
          this.quad.getBufferDescription(),
          particleInstanceLayout(2, 3)
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragment_main',
        targets: [
          {
            format: options.format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
            }
          }
        ]
      },
      primitive: {
        frontFace: 'cw',
        cullMode: 'back',
        topology: 'triangle-list'
      }
    });
  }

  /**
   * Encodes a render pass that clears `view` to black and draws the
   * particles into it. `projection` maps simulation space to clip space; it
   * reaches the GPU when the encoder is submitted, so draw at most once per
   * submitted encoder.
   */
  render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    projection: Float32Array<ArrayBuffer>,
    drawn: DrawnParticles
  ) {
    this.device.queue.writeBuffer(this.projectionBuffer, 0, projection);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }
      ]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroups[drawn.colors]);
    pass.setVertexBuffer(1, drawn.particles);
    this.quad.renderIndirect(pass, drawn.live, drawn.drawOffset);
    pass.end();
  }

  destroy() {
    this.projectionBuffer.destroy();
    this.quad.destroy();
  }
}
