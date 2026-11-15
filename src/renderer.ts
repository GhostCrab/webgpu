import { mat4 } from 'wgpu-matrix';

import GuiWrapper from './gui-wrapper';
import { bindInputs } from './input-bindings';
import { canvasToSimulation, fitViewport, Viewport } from './letterbox';
import { RenderPassDescriptor } from './render-pass-descriptor';
import { SimulationControls } from './simulation-controls';
import { Verlet } from './verlet/verlet';

import fullscreenTexturedQuadWGSL from './shaders/fullscreenTexturedQuad.wgsl';

// Fixed simulation resolution - physics will always run at 4K
const SIMULATION_WIDTH = 3840;
const SIMULATION_HEIGHT = 2160;

export default class Renderer {
  canvas: HTMLCanvasElement;

  // Simulation resolution (fixed, independent of window size)
  simWidth: number = SIMULATION_WIDTH;
  simHeight: number = SIMULATION_HEIGHT;

  // Where the simulation appears on the canvas, preserving its aspect ratio
  viewport: Viewport = { x: 0, y: 0, width: 0, height: 0 };

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

  fullscreenQuadPipeline: GPURenderPipeline;
  fullscreenQuadBindGroup: GPUBindGroup;

  lastFrameMS: number;

  // State
  running = true;

  controls: SimulationControls;
  tickInputs: () => void;
  verlet: Verlet;
  gui: GuiWrapper;

  constructor(canvas) {
    this.canvas = canvas;

    this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;

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

    this.controls = new SimulationControls({ constrainRadius: this.simHeight / 2 - 20 });

    this.tickInputs = bindInputs(this.controls, {
      toSimulation: (pageX, pageY) =>
        canvasToSimulation(
          this.viewport,
          this.simWidth,
          this.simHeight,
          pageX * window.devicePixelRatio,
          pageY * window.devicePixelRatio
        ),
      onReset: () => this.verlet.reset()
    });
  }

  // 🏎️ Start the rendering engine
  async start() {
    if (await this.initializeAPI()) {
      this.resizeBackings();
      await this.initializeResources();

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

  // 🍱 Initialize resources (render targets, pipelines, the simulation)
  async initializeResources() {
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

    // The simulation occupies a FIXED space, not the canvas size
    this.verlet = new Verlet(this.device, {
      bounds: this.simHeight,
      projection: mat4.ortho(
        -this.simWidth / 2,
        this.simWidth / 2,
        this.simHeight / 2,
        -this.simHeight / 2,
        1.05,
        -1
      ) as Float32Array,
      targetFormat: navigator.gpu.getPreferredCanvasFormat()
    });

    this.gui = new GuiWrapper(
      this.controls,
      {
        particleCount: this.verlet.particleCount,
        substeps: this.verlet.substeps,
        simWidth: this.simWidth,
        simHeight: this.simHeight
      },
      () => this.verlet.reset()
    );
  }

  // Calculate viewport to maintain aspect ratio (letterbox/pillarbox)
  updateViewport() {
    this.viewport = fitViewport(this.simWidth, this.simHeight, this.canvas.width, this.canvas.height);
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

  async render() {
    this.lastFrameMS = Date.now();

    do {
      const now = Date.now();
      const elapsed = (now - this.lastFrameMS) / 1000;
      // Never simulate more than one 60 Hz frame at a time
      const frameTime = Math.min(elapsed, 1 / 60);

      this.gui.updateFPS(1 / elapsed);

      const input = this.controls.frameInput();

      let commandEncoder = this.device.createCommandEncoder();

      if (!this.controls.paused) {
        this.verlet.step(commandEncoder, frameTime, input);
      }

      {
        // Render simulation to 4K texture
        this.simRenderPassDesc.updateResolveTarget(this.renderTexture.createView());

        let passEncoder = commandEncoder.beginRenderPass(this.simRenderPassDesc);
        this.verlet.draw(passEncoder);
        passEncoder.end();
      }

      {
        // Render 4K texture to canvas (scaled to window size with aspect ratio preservation)
        this.displayRenderPassDesc.updateResolveTarget(this.context.getCurrentTexture().createView());

        let passEncoder = commandEncoder.beginRenderPass(this.displayRenderPassDesc);

        // Set viewport to maintain aspect ratio (letterbox/pillarbox)
        passEncoder.setViewport(
          this.viewport.x,
          this.viewport.y,
          this.viewport.width,
          this.viewport.height,
          0,
          1
        );

        // Set scissor to match viewport
        passEncoder.setScissorRect(
          Math.floor(this.viewport.x),
          Math.floor(this.viewport.y),
          Math.floor(this.viewport.width),
          Math.floor(this.viewport.height)
        );

        passEncoder.setPipeline(this.fullscreenQuadPipeline);
        passEncoder.setBindGroup(0, this.fullscreenQuadBindGroup);
        passEncoder.draw(6);
        passEncoder.end();
      }

      this.queue.submit([commandEncoder.finish()]);

      this.lastFrameMS = now;

      // vsync
      this.tickInputs();
      await this.sleep();
    } while (this.running);
  }

  sleep() {
    return new Promise(requestAnimationFrame);
  }
}
