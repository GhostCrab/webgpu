import { Quad } from '../quad';
import { DrawTarget } from '../simulation-target';
import { particleInstanceLayout } from './particle-layout';
import shaderCode from './shaders/verlet-renderer.wgsl';

export interface VerletRendererOptions {
  /** Maps simulation space to clip space; a 4x4 matrix. */
  projection: Float32Array;
  /** The render pass configuration the particles are drawn into. */
  target: DrawTarget;
}

/** Draws particles as instanced quads cut to discs. Internal to Verlet. */
export class VerletRenderer {
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private quad: Quad;

  constructor(device: GPUDevice, options: VerletRendererOptions) {
    this.quad = new Quad(device);

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }]
    });

    const projectionBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(projectionBuffer, 0, new Float32Array(options.projection));

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: projectionBuffer } }]
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
          particleInstanceLayout(2, 3)
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragment_main',
        targets: [
          {
            format: options.target.format,
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
      },
      // 🌑 Depth
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: options.target.depthStencilFormat
      },
      multisample: {
        count: options.target.sampleCount
      }
    });
  }

  render(passEncoder: GPURenderPassEncoder, particleBuffer: GPUBuffer, count: number) {
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.setVertexBuffer(1, particleBuffer);
    this.quad.render(passEncoder, count);
  }
}
