import { GameInputs } from 'game-inputs'

import { mat4, vec2, Vec2 } from 'wgpu-matrix';

// import RenderStats from './renderStats';
import { RenderPassDescriptor } from './render-pass-descriptor';
import { Verlet } from './verlet/verlet';
import GuiWrapper from './gui-wrapper';

import fullscreenTexturedQuadWGSL from './shaders/fullscreenTexturedQuad.wgsl';

// Simulation Parameters Buffer Data
const simParamsArrayLength = 16;
const simParams = new Float32Array(simParamsArrayLength);

export const stepCount = 20;
let impulse = 2000;

// Fixed simulation resolution - physics will always run at 4K
const SIMULATION_WIDTH = 3840;
const SIMULATION_HEIGHT = 2160;

let mvp = mat4.identity();

export default class Renderer {
  canvas: HTMLCanvasElement;
  inputs: GameInputs;

  // Simulation resolution (fixed, independent of window size)
  simWidth: number = SIMULATION_WIDTH;
  simHeight: number = SIMULATION_HEIGHT;

  // Viewport for aspect ratio preservation
  viewportX: number = 0;
  viewportY: number = 0;
  viewportWidth: number = 0;
  viewportHeight: number = 0;

  // ⚙️ API Data Structures
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;

  // 🎞️ Frame Backings
  context: GPUCanvasContext;
  simRenderPassDesc: RenderPassDescriptor;  // For simulation rendering (4K)
  displayRenderPassDesc: RenderPassDescriptor;  // For final display (canvas size)

  // 🔺 Resources
  renderTexture: GPUTexture;
  mvpBuffer: GPUBuffer;
  simParamsBuffer: GPUBuffer;
  uniformBindGroupLayout: GPUBindGroupLayout;
  uniformBindGroup: GPUBindGroup;
  
  fullscreenQuadPipeline: GPURenderPipeline;
  fullscreenQuadBindGroup: GPUBindGroup;

  startFrameMS: number;
  lastFrameMS: number;

  // overlayElement: HTMLElement;

  // State
  running = true;
  devicePixelRatio: number;
  constrainRadius: number;
  // renderStats: RenderStats = new RenderStats();
  mousePos: Vec2;
  leftClickState: boolean;
  rightClickState: boolean;
  clickForce: number;
  doCollision: boolean;
  paused: boolean;
  clickLock: boolean;
  classicConstrain: boolean;

  verlet: Verlet;
  gui: GuiWrapper;
  impulse: number;
  gravityMode: number;
  gravityStrength: number;

  constructor(canvas) {
    this.canvas = canvas;
    this.devicePixelRatio = window.devicePixelRatio;

    this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;

    // this.overlayElement = document.getElementById('overlay');

    // Handle window resize
    window.addEventListener('resize', () => {
      this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
      this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;
      this.updateViewport();

      // Recreate display render pass descriptor with new canvas size
      if (this.device) {
        this.displayRenderPassDesc = new RenderPassDescriptor(this.device, this.canvas.width, this.canvas.height);
      }
    });

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
    this.impulse = impulse;
    this.gravityMode = 0; // 0 = constant (physically correct)
    this.gravityStrength = 2000.0;

    document.onmousemove = (event: MouseEvent) => {
      // Map mouse position from window space to simulation space
      // First get mouse position in canvas pixels
      const canvasX = event.pageX * window.devicePixelRatio;
      const canvasY = event.pageY * window.devicePixelRatio;

      // Account for viewport offset (letterboxing/pillarboxing)
      const viewportRelativeX = canvasX - this.viewportX;
      const viewportRelativeY = canvasY - this.viewportY;

      // Clamp to viewport bounds
      const clampedX = Math.max(0, Math.min(this.viewportWidth, viewportRelativeX));
      const clampedY = Math.max(0, Math.min(this.viewportHeight, viewportRelativeY));

      // Map from viewport space to simulation space
      const simX = (clampedX / this.viewportWidth) * this.simWidth;
      const simY = (clampedY / this.viewportHeight) * this.simHeight;

      // Center the coordinates (simulation uses center origin)
      this.mousePos = vec2.create(
         simX - (this.simWidth / 2),
         simY - (this.simHeight / 2)
      );
    }

    this.inputs.down.on('LMB', () => {
      this.leftClickState = true
      this.clickForce = this.impulse;
    });
    this.inputs.up.on('LMB', () => {
      this.leftClickState = false
      if (!this.rightClickState) {
        this.clickForce = 0;
      } else {
        this.clickForce = -this.impulse;
      }
    });

    this.inputs.down.on('RMB', () => {
      this.rightClickState = true
      this.clickForce = -this.impulse;
    });
    this.inputs.up.on('RMB', () => {
      this.rightClickState = false
      if (!this.leftClickState) {
        this.clickForce = 0;
      } else {
        this.clickForce = this.impulse;
      }
    });

    this.inputs.down.on('collideToggle', () => this.doCollision = !this.doCollision);
    this.inputs.down.on('pauseToggle', () => this.paused = !this.paused);
    this.inputs.down.on('clickLockToggle', () => this.clickLock = !this.clickLock);
    this.inputs.down.on('classicConstrainToggle', () => this.classicConstrain = !this.classicConstrain);

    this.inputs.down.on('reset', () => this.verlet.reset(this.device));
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
    // Simulation rendering uses FIXED 4K size
    this.simRenderPassDesc = new RenderPassDescriptor(this.device, this.simWidth, this.simHeight);
    // Display rendering uses canvas size
    this.displayRenderPassDesc = new RenderPassDescriptor(this.device, this.canvas.width, this.canvas.height);

    // Render texture uses FIXED simulation size, not canvas size
    this.renderTexture = this.device.createTexture({
      size: [this.simWidth, this.simHeight],
      format: "bgra8unorm",
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.fullscreenQuadPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.device.createShaderModule({
          code: fullscreenTexturedQuadWGSL,
        }),
        entryPoint: 'vert_main',
      },
      fragment: {
        module: this.device.createShaderModule({
          code: fullscreenTexturedQuadWGSL,
        }),
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat(),
        }],
        entryPoint: 'frag_main',
      },
      primitive: {
        topology: 'triangle-list',
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: 'depth24plus-stencil8'
      },
      multisample: {
        count: 4
      }
    });

    this.fullscreenQuadBindGroup = this.device.createBindGroup({
      layout: this.fullscreenQuadPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
          }),
        },
        {
          binding: 1,
          resource: this.renderTexture.createView(),
        },
      ],
    });

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

    // MVP uses FIXED simulation size, not canvas size
    mvp = mat4.ortho(
      -this.simWidth / 2,
      this.simWidth / 2,
      this.simHeight / 2,
      -this.simHeight / 2,
      1.05,
      -1
    );
    this.mvpBuffer = createBuffer(mvp as Float32Array, GPUBufferUsage.UNIFORM);
    this.constrainRadius = this.simHeight / 2 - 20;

    simParams[0] = 0; // deltaTime
    simParams[1] = 0; // totalTime
    simParams[2] = this.constrainRadius; // constrainRadius
    simParams[3] = this.simHeight; // boxDim
    simParams.set([0x00000000], 4); // u32 constrainType
    simParams.set([0x00000000], 5); // u32 gravityMode (0 = constant)
    simParams[6] = 2000.0; // gravityStrength
    simParams[7] = 0; // unused2
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

    // Verlet uses FIXED simulation size, not canvas size
    this.verlet = new Verlet(this.simHeight, this.uniformBindGroupLayout, this.device);

    // Initialize GUI
    this.gui = new GuiWrapper();
    this.gui.init({
      particleCount: this.verlet.objectCount,
      doCollision: this.doCollision,
      paused: this.paused,
      clickLock: this.clickLock,
      classicConstrain: this.classicConstrain,
      constrainRadius: this.constrainRadius,
      impulse: this.impulse,
      stepCount: stepCount,
      simWidth: this.simWidth,
      simHeight: this.simHeight,
      gravityMode: this.gravityMode,
      gravityStrength: this.gravityStrength,
    }, {
      onCollisionToggle: () => { this.doCollision = !this.doCollision; },
      onPauseToggle: () => { this.paused = !this.paused; },
      onClickLockToggle: () => { this.clickLock = !this.clickLock; },
      onClassicConstrainToggle: () => { this.classicConstrain = !this.classicConstrain; },
      onReset: () => { this.verlet.reset(this.device); },
      onConstrainRadiusChange: (value) => {
        this.constrainRadius = value;
        simParams[2] = value;
      },
      onImpulseChange: (value) => {
        this.impulse = value;
      },
      onGravityModeChange: (value) => {
        this.gravityMode = value;
        simParams[5] = value;
      },
      onGravityStrengthChange: (value) => {
        this.gravityStrength = value;
        simParams[6] = value;
      },
    });
  }

  // Calculate viewport to maintain aspect ratio (letterbox/pillarbox)
  updateViewport() {
    const simAspect = this.simWidth / this.simHeight;
    const canvasAspect = this.canvas.width / this.canvas.height;

    if (canvasAspect > simAspect) {
      // Canvas is wider - add pillarboxing (black bars on sides)
      this.viewportHeight = this.canvas.height;
      this.viewportWidth = this.canvas.height * simAspect;
      this.viewportX = (this.canvas.width - this.viewportWidth) / 2;
      this.viewportY = 0;
    } else {
      // Canvas is taller - add letterboxing (black bars on top/bottom)
      this.viewportWidth = this.canvas.width;
      this.viewportHeight = this.canvas.width / simAspect;
      this.viewportX = 0;
      this.viewportY = (this.canvas.height - this.viewportHeight) / 2;
    }
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

    this.updateViewport();
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

      // this.renderStats.updateOverlay((now - this.lastFrameMS) / 1000, this);

      // Update GUI FPS
      this.gui.updateFPS(1 / ((now - this.lastFrameMS) / 1000));
      this.gui.updateParams({
        doCollision: this.doCollision,
        paused: this.paused,
        clickLock: this.clickLock,
        classicConstrain: this.classicConstrain,
      });

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
        // Render simulation to 4K texture
        this.simRenderPassDesc.updateResolveTarget(this.renderTexture.createView());

        let passEncoder = commandEncoder.beginRenderPass(this.simRenderPassDesc);
        passEncoder.setBindGroup(0, this.uniformBindGroup);

        this.verlet.render(passEncoder);
        passEncoder.end();
      }

      {
        // Render 4K texture to canvas (scaled to window size with aspect ratio preservation)
        this.displayRenderPassDesc.updateResolveTarget(this.context.getCurrentTexture().createView());

        let passEncoder = commandEncoder.beginRenderPass(this.displayRenderPassDesc);

        // Set viewport to maintain aspect ratio (letterbox/pillarbox)
        passEncoder.setViewport(
          this.viewportX,
          this.viewportY,
          this.viewportWidth,
          this.viewportHeight,
          0,
          1
        );

        // Set scissor to match viewport
        passEncoder.setScissorRect(
          Math.floor(this.viewportX),
          Math.floor(this.viewportY),
          Math.floor(this.viewportWidth),
          Math.floor(this.viewportHeight)
        );

        passEncoder.setPipeline(this.fullscreenQuadPipeline);
        passEncoder.setBindGroup(0, this.fullscreenQuadBindGroup);
        passEncoder.draw(6);
        passEncoder.end();
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
