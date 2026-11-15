import { Quad } from '../quad';
import type { DrawTarget } from '../simulation-target';
import discShaderCode from './shaders/particle-disc.wgsl';

export interface VerletRendererOptions {
  /** Maps simulation space to clip space; a 4x4 matrix. */
  projection: Float32Array;
  /** The render pass configuration the particles are drawn into. */
  target: DrawTarget;
  /**
   * The pipeline's vertex shader: a vertex_main appended to particle-disc.wgsl,
   * reading the particle buffer through `instanceLayout`.
   */
  vertexShader: string;
  /** The particle buffer as a per-instance vertex buffer, at locations 2 and up. */
  instanceLayout: GPUVertexBufferLayout;
  /** A storage buffer the vertex shader reads at group 0, binding 1, if it needs one. */
  colorBuffer?: GPUBuffer;
}

/** Draws particles as instanced quads cut to discs. Internal to Verlet. */
export class VerletRenderer {
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private projectionBuffer: GPUBuffer;
  private quad: Quad;

  constructor(device: GPUDevice, options: VerletRendererOptions) {
    this.quad = new Quad(device);

    const layoutEntries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
    ];
    if (options.colorBuffer) {
      layoutEntries.push({
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' }
      });
    }
    const bindGroupLayout = device.createBindGroupLayout({ entries: layoutEntries });

    this.projectionBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(this.projectionBuffer, 0, new Float32Array(options.projection));

    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.projectionBuffer } }];
    if (options.colorBuffer) {
      entries.push({ binding: 1, resource: { buffer: options.colorBuffer } });
    }
    this.bindGroup = device.createBindGroup({ layout: bindGroupLayout, entries });

    const shaderModule = device.createShaderModule({
      code: discShaderCode + '\n' + options.vertexShader
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertex_main',
        buffers: [
          // quad buffer layout takes locations 0 - 1
          this.quad.getBufferDescription(),
          options.instanceLayout
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

  destroy() {
    this.projectionBuffer.destroy();
    this.quad.destroy();
  }
}
