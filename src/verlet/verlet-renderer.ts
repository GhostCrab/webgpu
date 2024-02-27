import { Quad } from "../quad";
import shaderCode from './verlet.wgsl';

export class VerletRenderer implements GPURenderPipelineDescriptor {
  layout: GPUPipelineLayout;
  vertex: GPUVertexState;
  fragment: GPUFragmentState;
  primitive: GPUPrimitiveState;
  depthStencil: GPUDepthStencilState;
  multisample: GPUMultisampleState;

  pipeline: GPURenderPipeline;

  shaderModule: GPUShaderModule;

  buffers: GPUBuffer[];

  quad: Quad;
  quadCount: number;
  
  constructor(layout: GPUPipelineLayout, device: GPUDevice) {
    this.quad = new Quad(device);
    this.layout = layout;

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

  initBuffers(device: GPUDevice, dataArray: Float32Array, quadCount: number) {
    this.quadCount = quadCount;
    this.buffers = new Array(2);
    for (let i = 0; i < 2; ++i) {
      this.buffers[i] = device.createBuffer({
        size: dataArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(this.buffers[i].getMappedRange()).set(dataArray);
      this.buffers[i].unmap();
    }
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

  render(passEncoder: GPURenderPassEncoder, frame: number) {
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setVertexBuffer(1, this.buffers[(frame + 1) % 2]);
    this.quad.render(passEncoder, this.quadCount);
  }
}