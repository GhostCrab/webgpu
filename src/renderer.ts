import { mat4 } from 'wgpu-matrix';

import RenderStats from './renderStats';
import { RenderPassDescriptor } from './render-pass-descriptor';
import { Verlet } from './verlet/verlet';

// Simulation Parameters Buffer Data
// f32 deltaTime, f32 totalTime, f32 constrainRadius, f32 boxDim, vec4<f32> constrainCenter, vec4<f32> clickPoint
const simParamsArrayLength = 12;
const simParams = new Float32Array(simParamsArrayLength);

const doGPUCompute = false;

export const stepCount = 8;

let mvp = mat4.identity();

export default class Renderer {
  canvas: HTMLCanvasElement;

  // ⚙️ API Data Structures
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;

  // 🎞️ Frame Backings
  context: GPUCanvasContext;
  renderPassDesc: RenderPassDescriptor;

  // 🔺 Resources
  mvpBuffer: GPUBuffer;
  simParamsBuffer: GPUBuffer;
  uniformBindGroup: GPUBindGroup;
  pipeline: GPURenderPipeline;

  startFrameMS: number;
  lastFrameMS: number;

  overlayElement: HTMLElement;

  // State
  running = true;
  devicePixelRatio: number;
  renderStats: RenderStats = new RenderStats();

  verlet: Verlet;

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

    // ⚗️ Graphics Pipeline
    this.renderPassDesc = new RenderPassDescriptor(this.device, this.canvas);

    // 🦄 Uniform Data
    const globalUniformBindGroupLayout = this.device.createBindGroupLayout({
      label: 'renderBindGroupLayout',
      entries: [{
          binding: 0, // mvp
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        }, {
          binding: 1, // params
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
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
    simParams[3] = this.canvas.height; // boxDim
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
      layout: globalUniformBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.mvpBuffer }
      }, {
        binding: 1,
        resource: { buffer: this.simParamsBuffer }
      }]
    });

    this.verlet = new Verlet(this.canvas.height, globalUniformBindGroupLayout, this.device);
  }

  // ↙️ Resize swapchain, frame buffer attachments
  resizeBackings() {
    // ⛓️ Swapchain
    if (!this.context) {
      this.context = this.canvas.getContext('webgpu');
      const canvasConfig: GPUCanvasConfiguration = {
        device: this.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        alphaMode: 'premultiplied',
      };
      this.context.configure(canvasConfig);
    }

    // TODO: resize this.renderPassDesc
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
    let frame = 0;
    // this.startFrameMS = performance.timeOrigin + performance.now();
    // this.lastFrameMS = performance.timeOrigin + performance.now();
    this.startFrameMS = Date.now();
    this.lastFrameMS = Date.now();
    do {
      // const now = performance.timeOrigin + performance.now();
      // const deltaTime = Math.min((now - this.lastFrameMS) / 1000, 1 / 60);
      // const totalTime = (now - this.startFrameMS) / 1000;

      const now = Date.now();
      const deltaTime = Math.min((now - this.lastFrameMS) / 1000, 1 / 60);
      const totalTime = (now - this.startFrameMS) / 1000;

      this.renderStats.updateFPS((now - this.lastFrameMS) / 1000, this.overlayElement);

      let clickPointX = 0;
      let clickPointY = 0;
      // if (input.analog.right) {
      //   clickPointX = (input.analog.clickX * devicePixelRatio) - (canvas.width / 2);
      //   clickPointY = (input.analog.clickY * devicePixelRatio) - (canvas.height / 2);
      // }

      this.updateSimParams(totalTime, deltaTime / stepCount, clickPointX, clickPointY);
      for (let i = 0; i < stepCount; i++) {
        if (doGPUCompute) {
          const commandBuffers = await this.verlet.compute(this.device, this.uniformBindGroup);

          this.queue.submit(commandBuffers);
          await this.queue.onSubmittedWorkDone();
        } else {
          this.verlet.computeCPU(this.device, simParams);
        }
      }
      
      {
        // ⏭ Acquire next image from context
        this.renderPassDesc.updateResolveTarget(this.context.getCurrentTexture().createView()); 

        let commandEncoder = this.device.createCommandEncoder();
        let passEncoder = commandEncoder.beginRenderPass(this.renderPassDesc);
        passEncoder.setBindGroup(0, this.uniformBindGroup);
        passEncoder.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
        passEncoder.setScissorRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.verlet.render(passEncoder);
        
        passEncoder.end();

        this.queue.submit([commandEncoder.finish()]);
        // await this.queue.onSubmittedWorkDone();
      }
  
      // Wait for repaint
      this.lastFrameMS = now;
      
      // vsync
      await this.sleep();
    } while (this.running);
  }

  sleep() {
    return new Promise(requestAnimationFrame);
  }
}
