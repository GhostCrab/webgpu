import { mat4, vec3 } from 'wgpu-matrix';
import { Quad } from './quad';

import vertShaderCode from './shaders/triangle.vert.wgsl';
import fragShaderCode from './shaders/triangle.frag.wgsl';
import RenderStats from './renderStats';

// Simulation Parameters Buffer Data
// f32 deltaTime, f32 totalTime, f32 constrainRadius, f32 boxDim, vec4<f32> constrainCenter, vec4<f32> clickPoint
const simParamsArrayLength = 12;
const simParams = new Float32Array(simParamsArrayLength);
let quad: Quad;
let mvp = mat4.identity();

export default class Renderer {
  canvas: HTMLCanvasElement;

  // ⚙️ API Data Structures
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;

  // 🎞️ Frame Backings
  context: GPUCanvasContext;
  colorTexture: GPUTexture;
  colorTextureView: GPUTextureView;
  depthTexture: GPUTexture;
  depthTextureView: GPUTextureView;

  // 🔺 Resources
  mvpBuffer: GPUBuffer;
  simParamsBuffer: GPUBuffer;
  uniformBindGroup: GPUBindGroup;
  vertModule: GPUShaderModule;
  fragModule: GPUShaderModule;
  pipeline: GPURenderPipeline;

  commandEncoder: GPUCommandEncoder;
  passEncoder: GPURenderPassEncoder;

  startFrameMS: number;
  lastFrameMS: number;

  overlayElement: HTMLElement;

  // State
  running = true;
  devicePixelRatio: number;
  renderStats: RenderStats = new RenderStats();

  constructor(canvas) {
    this.canvas = canvas;
    this.devicePixelRatio = window.devicePixelRatio;

    this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;

    this.overlayElement = document.getElementById('overlay');
  }

  // 🏎️ Start the rendering engine
  async start() {
    if (await this.initializeAPI()) {
      this.resizeBackings();
      await this.initializeResources();

      this.startFrameMS = Date.now();
      this.lastFrameMS = Date.now();

      this.render();
    }
  }

  // 🌟 Initialize WebGPU
  async initializeAPI(): Promise<boolean> {
    try {
      // 🏭 Entry to WebGPU
      const entry: GPU = navigator.gpu;
      if (!entry) {
        return false;
      }

      // 🔌 Physical Device Adapter
      this.adapter = await entry.requestAdapter();

      // 💻 Logical Device
      this.device = await this.adapter.requestDevice();

      // 📦 Queue
      this.queue = this.device.queue;
    } catch (e) {
      console.error(e);
      return false;
    }

    return true;
  }

  // 🍱 Initialize resources to render triangle (buffers, shaders, pipeline)
  async initializeResources() {
    // 🔺 Buffers
    const createBuffer = (
      arr: Float32Array | Uint16Array | Uint32Array,
      usage: number
    ) => {
      // 📏 Align to 4 bytes (thanks @chrimsonite)
      let desc = {
        size: (arr.byteLength + 3) & ~3,
        usage,
        mappedAtCreation: true
      };
      let buffer = this.device.createBuffer(desc);
      const writeArray =
        arr instanceof Uint16Array
          ? new Uint16Array(buffer.getMappedRange())
          : arr instanceof Uint32Array
          ? new Uint32Array(buffer.getMappedRange())
          : new Float32Array(buffer.getMappedRange());
      writeArray.set(arr);
      buffer.unmap();
      return buffer;
    };

    quad = new Quad(this.device);

    // 🖍️ Shaders
    const vsmDesc = {
      code: vertShaderCode
    };
    this.vertModule = this.device.createShaderModule(vsmDesc);

    const fsmDesc = {
      code: fragShaderCode
    };
    this.fragModule = this.device.createShaderModule(fsmDesc);

    // ⚗️ Graphics Pipeline

    // 🌑 Depth
    const depthStencil: GPUDepthStencilState = {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus-stencil8'
    };

    // 🦄 Uniform Data
    const renderBindGroupLayout = this.device.createBindGroupLayout({
      label: 'renderBindGroupLayout',
      entries: [{
          binding: 0, // mvp
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        }, {
          binding: 1, // params
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        }
      ]
    });

    mvp = mat4.ortho(
      -this.canvas.width / 2,
      this.canvas.width / 2,
      this.canvas.height / 2,
      -this.canvas.height / 2,
      1.05,
      -1
    );
    this.mvpBuffer = createBuffer(mvp as Float32Array, GPUBufferUsage.UNIFORM);

    simParams[0] = 0; // deltaTime
    simParams[1] = 0; // totalTime
    simParams[2] = this.canvas.height / 2 - 20; // constrainRadius
    simParams[3] = 0; // boxDim
    simParams[4] = 0; // constrainCenter.x
    simParams[5] = 0; // constrainCenter.y
    simParams[6] = 0; // constrainCenter.z
    simParams[7] = 0; // constrainCenter.w
    simParams[8] = 0; // clickPoint.x
    simParams[9] = 0; // clickPoint.y
    simParams[10] = 0; // clickPoint.z
    simParams[11] = 0; // clickPoint.w
    this.simParamsBuffer = createBuffer(
      simParams,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );

    this.uniformBindGroup = this.device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.mvpBuffer }
      }, {
        binding: 1,
        resource: { buffer: this.simParamsBuffer }
      }]
    });

    const pipelineLayoutDesc = { bindGroupLayouts: [renderBindGroupLayout] };
    const layout = this.device.createPipelineLayout(pipelineLayoutDesc);

    // 🎭 Shader Stages
    const vertex: GPUVertexState = {
      module: quad.shaderModule,
      entryPoint: 'main',
      buffers: quad.getBufferDescription()
    };

    // 🌀 Color/Blend State
    const colorState: GPUColorTargetState = {
      format: 'bgra8unorm'
    };

    const fragment: GPUFragmentState = {
      module: this.fragModule,
      entryPoint: 'main',
      targets: [colorState]
    };

    // 🟨 Rasterization
    const primitive: GPUPrimitiveState = {
      frontFace: 'cw',
      cullMode: 'none',
      topology: 'triangle-list'
    };

    const multisample: GPUMultisampleState = {
      count: 1
    };

    const pipelineDesc: GPURenderPipelineDescriptor = {
      layout,

      vertex,
      fragment,

      primitive,
      depthStencil,

      multisample
    };
    this.pipeline = this.device.createRenderPipeline(pipelineDesc);
  }

  // ↙️ Resize swapchain, frame buffer attachments
  resizeBackings() {
    // ⛓️ Swapchain
    if (!this.context) {
      this.context = this.canvas.getContext('webgpu');
      const canvasConfig: GPUCanvasConfiguration = {
        device: this.device,
        format: 'bgra8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        alphaMode: 'opaque'
      };
      this.context.configure(canvasConfig);
    }

    const depthTextureDesc: GPUTextureDescriptor = {
      size: [this.canvas.width, this.canvas.height, 1],
      sampleCount: 1,
      dimension: '2d',
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    };

    this.depthTexture = this.device.createTexture(depthTextureDesc);
    this.depthTextureView = this.depthTexture.createView();
  }

  // ✍️ Write commands to send to the GPU
  encodeCommands() {
    let colorAttachment: GPURenderPassColorAttachment = {
      view: this.colorTextureView,
      clearValue: { r: 0.0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    };

    const depthAttachment: GPURenderPassDepthStencilAttachment = {
      view: this.depthTextureView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      stencilClearValue: 0,
      stencilLoadOp: 'clear',
      stencilStoreOp: 'store'
    };

    const renderPassDesc: GPURenderPassDescriptor = {
      colorAttachments: [colorAttachment],
      depthStencilAttachment: depthAttachment
    };

    this.commandEncoder = this.device.createCommandEncoder();

    // 🖌️ Encode drawing commands
    this.passEncoder = this.commandEncoder.beginRenderPass(renderPassDesc);
    this.passEncoder.setPipeline(this.pipeline);
    this.passEncoder.setViewport(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      1
    );
    this.passEncoder.setScissorRect(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
    this.passEncoder.setBindGroup(0, this.uniformBindGroup);
    this.passEncoder.setVertexBuffer(0, quad.verticesBuffer);
    this.passEncoder.setIndexBuffer(quad.indexBuffer, 'uint16');
    this.passEncoder.drawIndexed(6, 2);
    this.passEncoder.end();

    this.queue.submit([this.commandEncoder.finish()]);
  }

  updateSimParams(
    totalTime: number,
    deltaTime: number,
    clickPointX = 0,
    clickPointY = 0
  ) {
    simParams[0] = totalTime;
    simParams[1] = deltaTime;
    simParams[8] = clickPointX;
    simParams[9] = clickPointY;
    this.device.queue.writeBuffer(this.simParamsBuffer, 0, simParams);
  }

  async render() {
    do {
      const now = performance.now();
      const deltaTime = Math.min((now - this.lastFrameMS) / 1000, 1 / 60);
      const totalTime = now / 1000;
      this.renderStats.updateFPS(deltaTime, this.overlayElement);
      // this.overlayElement.innerText = `${Math.round((1/deltaTime) * 100) / 100}`;

      // ⏭ Acquire next image from context
      this.colorTexture = this.context.getCurrentTexture();
      this.colorTextureView = this.colorTexture.createView();

      let clickPointX = 0;
      let clickPointY = 0;
      // if (input.analog.right) {
      //   clickPointX = (input.analog.clickX * devicePixelRatio) - (canvas.width / 2);
      //   clickPointY = (input.analog.clickY * devicePixelRatio) - (canvas.height / 2);
      // }

      this.updateSimParams(totalTime, deltaTime, clickPointX, clickPointY);

      // 📦 Write and submit commands to queue
      this.encodeCommands();

      // Wait for repaint
      this.lastFrameMS = now;
      await this.sleep();
    } while (this.running);
  }

  sleep() {
    return new Promise(requestAnimationFrame);
  }
}
