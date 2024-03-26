import { GameInputs } from 'game-inputs'

import { mat4, vec2, Vec2 } from 'wgpu-matrix';

import RenderStats from './renderStats';
import { RenderPassDescriptor } from './render-pass-descriptor';
import { Verlet } from './verlet/verlet';

// Simulation Parameters Buffer Data
const simParamsArrayLength = 16;
const simParams = new Float32Array(simParamsArrayLength);

export const stepCount = 24;
const impulse = 5000;

let mvp = mat4.identity();

export default class Renderer {
  canvas: HTMLCanvasElement;
  inputs: GameInputs;

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
  uniformBindGroupLayout: GPUBindGroupLayout;
  uniformBindGroup: GPUBindGroup;
  pipeline: GPURenderPipeline;

  startFrameMS: number;
  lastFrameMS: number;

  overlayElement: HTMLElement;

  // State
  running = true;
  devicePixelRatio: number;
  constrainRadius: number;
  renderStats: RenderStats = new RenderStats();
  mousePos: Vec2;
  leftClickState: boolean;
  rightClickState: boolean;
  clickForce: number;
  doCollision: boolean;
  paused: boolean;
  clickLock: boolean;
  classicConstrain: boolean;

  verlet: Verlet;

  constructor(canvas) {
    this.canvas = canvas;
    this.devicePixelRatio = window.devicePixelRatio;

    this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;

    this.overlayElement = document.getElementById('overlay');

    this.inputs = new GameInputs(undefined, {
      preventDefaults: false, 
      allowContextMenu: false,
      stopPropagation: false,
      disabled: false
    });

    this.inputs.bind('LMB', 'Mouse1');
    this.inputs.bind('RMB', 'Mouse3');
    this.inputs.bind('reset', 'KeyR');
    this.inputs.bind('collideToggle', 'KeyC');
    this.inputs.bind('classicConstrainToggle', 'KeyT');
    this.inputs.bind('pauseToggle', 'KeyP');
    this.inputs.bind('clickLockToggle', 'KeyL');

    this.doCollision = true;
    this.paused = false;

    this.mousePos = vec2.create(0.0, 0.0);
    this.rightClickState = false;
    this.leftClickState = false;
    this.clickForce = 0;
    this.clickLock = false;
    this.classicConstrain = false;

    document.onmousemove = (event: MouseEvent) => {
      this.mousePos = vec2.create(
         (event.pageX * window.devicePixelRatio) - (this.canvas.width / 2), 
         (event.pageY * window.devicePixelRatio) - (this.canvas.height / 2)
      );
    }

    this.inputs.down.on('LMB', (ev: any) => {
      this.leftClickState = true
      this.clickForce = impulse;
    });
    this.inputs.up.on('LMB', (ev: any) => {
      this.leftClickState = false
      if (!this.rightClickState) {
        this.clickForce = 0;
      } else {
        this.clickForce = -impulse;
      }
    });

    this.inputs.down.on('RMB', (ev: any) => {
      this.rightClickState = true
      this.clickForce = -impulse;
    });
    this.inputs.up.on('RMB', (ev: any) => {
      this.rightClickState = false
      if (!this.leftClickState) {
        this.clickForce = 0;
      } else {
        this.clickForce = impulse;
      }
    });

    this.inputs.down.on('collideToggle', (ev: any) => this.doCollision = !this.doCollision);
    this.inputs.down.on('pauseToggle', (ev: any) => this.paused = !this.paused);
    this.inputs.down.on('clickLockToggle', (ev: any) => this.clickLock = !this.clickLock);
    this.inputs.down.on('classicConstrainToggle', (ev: any) => this.classicConstrain = !this.classicConstrain);

    this.inputs.down.on('reset', (ev: any) => this.verlet.reset(this.device));
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
    this.uniformBindGroupLayout = this.device.createBindGroupLayout({
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
    this.constrainRadius = this.canvas.height / 2 - 20;

    simParams[0] = 0; // deltaTime
    simParams[1] = 0; // totalTime
    simParams[2] = this.constrainRadius; // constrainRadius
    simParams[3] = this.canvas.height; // boxDim
    simParams.set([0x00000000], 4); // u32 constrainType
    simParams[5] = 0;
    simParams[6] = 0;
    simParams[7] = 0;
    simParams[8] = 0; // constrainCenter.x
    simParams[9] = 0; // constrainCenter.y
    simParams[10] = 0; // constrainCenter.z
    simParams[11] = 0; // constrainCenter.w
    simParams[12] = 0; // clickPoint.x
    simParams[13] = 0; // clickPoint.y
    simParams[14] = 0; // clickPoint.z
    simParams[15] = 0; // clickPoint.w
    this.simParamsBuffer = createBuffer(
      simParams,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );

    this.uniformBindGroup = this.device.createBindGroup({
      layout: this.uniformBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.mvpBuffer }
      }, {
        binding: 1,
        resource: { buffer: this.simParamsBuffer }
      }]
    });

    console.log(this.canvas);

    this.verlet = new Verlet(this.canvas.height, this.uniformBindGroupLayout, this.device);
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
    clickPointY = 0,
    clickForce = 0
  ) {
    simParams[0] = totalTime;
    simParams[1] = deltaTime;
    simParams[12] = clickPointX;
    simParams[13] = clickPointY;
    simParams[14] = clickForce;

    if (this.classicConstrain) {
      simParams.set([0x00000000], 4);
    } else {
      simParams.set([0x00000001], 4);
    }

    this.device.queue.writeBuffer(this.simParamsBuffer, 0, simParams);
  }
  

  async render() {
    let frame = 0;
    // this.startFrameMS = performance.timeOrigin + performance.now();
    // this.lastFrameMS = performance.timeOrigin + performance.now();
    this.startFrameMS = Date.now();
    this.lastFrameMS = Date.now();

    let clickPointX = 0;
    let clickPointY = 0;
    let clickForce = 0;

    do {
      // const now = performance.timeOrigin + performance.now();
      // const deltaTime = Math.min((now - this.lastFrameMS) / 1000, 1 / 60);
      // const totalTime = (now - this.startFrameMS) / 1000;

      const now = Date.now();
      const deltaTime = Math.min((now - this.lastFrameMS) / 1000, 1 / 60);
      const totalTime = (now - this.startFrameMS) / 1000;

      this.renderStats.updateOverlay((now - this.lastFrameMS) / 1000, this);

      // Framerate Protection - if fps drops below 10, turn off collisions
      // if (1 / ((now - this.lastFrameMS) / 1000) < 10) {
      //   this.doCollision = false;
      // }


      if (this.leftClickState || this.rightClickState) {
        clickPointX = this.mousePos[0];
        clickPointY = this.mousePos[1];
        clickForce = this.clickForce;
      } else if (!this.clickLock) {
        clickPointX = 0;
        clickPointY = 0;
        clickForce = 0;
      }

      let commandEncoder = this.device.createCommandEncoder();

      this.updateSimParams(totalTime, deltaTime / stepCount, clickPointX, clickPointY, clickForce);
      if (!this.paused) {
        for (let i = 0; i < stepCount; i++) {
          this.verlet.compute(this.device, commandEncoder, this.uniformBindGroup, this.doCollision);
        }
      }
      
      {
        // ⏭ Acquire next image from context
        this.renderPassDesc.updateResolveTarget(this.context.getCurrentTexture().createView()); 

        let passEncoder = commandEncoder.beginRenderPass(this.renderPassDesc);
        passEncoder.setBindGroup(0, this.uniformBindGroup);
        passEncoder.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
        passEncoder.setScissorRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.verlet.render(passEncoder);
        
        passEncoder.end();
        // await this.queue.onSubmittedWorkDone();
      }

      this.queue.submit([commandEncoder.finish()]);
  
      // Wait for repaint
      this.lastFrameMS = now;
      
      // vsync
      this.inputs.tick();
      await this.sleep();
      // await this.queue.onSubmittedWorkDone();
    } while (this.running);
  }

  sleep() {
    return new Promise(requestAnimationFrame);
  }
}
