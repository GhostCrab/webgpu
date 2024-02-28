import { Quad } from "../quad";
import shaderCode from './verlet-renderer.wgsl';

export class VerletRenderer implements GPURenderPipelineDescriptor {
  // GPURenderPipelineDescriptor members
  layout: GPUPipelineLayout;
  vertex: GPUVertexState;
  fragment: GPUFragmentState;
  primitive: GPUPrimitiveState;
  depthStencil: GPUDepthStencilState;
  multisample: GPUMultisampleState;

  pipeline: GPURenderPipeline;

  shaderModule: GPUShaderModule;

  quad: Quad;
  
  constructor(globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice) {
    this.quad = new Quad(device);

    const pipelineLayoutDesc = { bindGroupLayouts: [globalUniformBindGroupLayout] };
    this.layout = device.createPipelineLayout(pipelineLayoutDesc);

    this.shaderModule = device.createShaderModule({
      code: shaderCode
    });

    this.vertex = {
      module: this.shaderModule,
      entryPoint: 'vertex_main',
      buffers: [
        this.quad.getBufferDescription(),
        this.getBufferDescription()
      ]
    };

    this.fragment = {
      module: this.shaderModule,
      entryPoint: 'fragment_main',
      targets: [{
        format: navigator.gpu.getPreferredCanvasFormat(),
        blend: {
          color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'zero',
            dstFactor: 'one',
            operation: 'add',
          },
        }
      }]
    };

    this.primitive = {
      frontFace: 'cw',
      cullMode: 'back',
      topology: 'triangle-list'
    };

    // 🌑 Depth
    this.depthStencil = {
      depthWriteEnabled: false,
      depthCompare: 'less',
      format: 'depth24plus-stencil8'
    };

    this.multisample = {
      count: 4
    };

    this.pipeline = device.createRenderPipeline(this);
  }

  getBufferDescription(): GPUVertexBufferLayout {
    // quad buffer layout takes positions 0 - 1
    return {
      // instanced particles buffer
      arrayStride: 16 * 4,
      stepMode: 'instance',
      attributes: [{
          // instance position
          shaderLocation: 2,
          offset: 0,
          format: 'float32x4',
        }, {
          // instance previous position
          shaderLocation: 3,
          offset: 4 * 4,
          format: 'float32x4',
        }, {
          // instance acceleration
          shaderLocation: 4,
          offset: 8 * 4,
          format: 'float32x4',
        }, {
          // instance rgb-Radius
          shaderLocation: 5,
          offset: 12 * 4,
          format: 'float32x4',
        },
      ],
    }
  }

  render(passEncoder: GPURenderPassEncoder, buffer: GPUBuffer, count: number) {
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setVertexBuffer(1, buffer);
    this.quad.render(passEncoder, count);
  }
}