import { Quad } from '../quad';
import { particleInstanceLayout } from './particle-layout';
import shaderCode from './shaders/particle-disc.wgsl';

export interface VerletRendererOptions {
  /** Format of the canvas the particles are drawn to. */
  format: GPUTextureFormat;
  /** One colour per particle, at its particle id. */
  colorBuffer: GPUBuffer;
}

/**
 * Draws particles as instanced quads cut to discs, straight to the canvas.
 * Internal to Verlet.
 */
export class VerletRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
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

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.projectionBuffer } },
        { binding: 1, resource: { buffer: options.colorBuffer } }
      ]
    });

    const shaderModule = device.createShaderModule({ code: shaderCode });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertex_main',
        buffers: [
          // quad buffer layout takes locations 0 - 1
          this.quad.getBufferDescription(),
          particleInstanceLayout(2, 3, 4)
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
    particleBuffer: GPUBuffer,
    count: number
  ) {
    this.device.queue.writeBuffer(this.projectionBuffer, 0, projection);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }
      ]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(1, particleBuffer);
    this.quad.render(pass, count);
    pass.end();
  }

  destroy() {
    this.projectionBuffer.destroy();
    this.quad.destroy();
  }
}
