import { Quad } from "../quad";
import { particleInstanceLayout } from "./particle-layout";
import shaderCode from './shaders/verlet-renderer.wgsl';

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
        // quad buffer layout takes locations 0 - 1
        particleInstanceLayout(2, 3)
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

  render(passEncoder: GPURenderPassEncoder, buffer: GPUBuffer, count: number) {
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setVertexBuffer(1, buffer);
    this.quad.render(passEncoder, count);
  }
}