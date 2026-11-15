import GuiWrapper from './gui-wrapper';
import { bindInputs } from './input-bindings';
import { SimulationControls } from './simulation-controls';
import { SimulationTarget } from './simulation-target';
import { Verlet } from './verlet/verlet';

// Fixed simulation resolution - physics will always run at 4K
const SIMULATION_WIDTH = 3840;
const SIMULATION_HEIGHT = 2160;

/** Owns the canvas and the frame loop, and wires the other modules together. */
export default class Renderer {
  canvas: HTMLCanvasElement;

  // ⚙️ API Data Structures
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;
  context: GPUCanvasContext;

  running = true;

  controls: SimulationControls;
  target: SimulationTarget;
  verlet: Verlet;
  gui: GuiWrapper;
  tickInputs: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.controls = new SimulationControls({ constrainRadius: SIMULATION_HEIGHT / 2 - 20 });
  }

  // 🏎️ Start the rendering engine
  async start() {
    if (await this.initializeAPI()) {
      this.initializeResources();
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

  // 🍱 Initialize resources (swapchain, render target, the simulation, inputs)
  initializeResources() {
    const format = navigator.gpu.getPreferredCanvasFormat();

    // ⛓️ Swapchain
    this.context = this.canvas.getContext('webgpu');
    this.context.configure({
      device: this.device,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: 'premultiplied'
    });

    // The simulation occupies a FIXED space, not the canvas size
    this.target = new SimulationTarget(this.device, {
      width: SIMULATION_WIDTH,
      height: SIMULATION_HEIGHT,
      format
    });

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.verlet = new Verlet(this.device, {
      bounds: SIMULATION_HEIGHT,
      projection: this.target.projection,
      target: this.target.drawTarget
    });

    this.tickInputs = bindInputs(this.controls, {
      toSimulation: (pageX, pageY) =>
        this.target.toSimulation(
          pageX * window.devicePixelRatio,
          pageY * window.devicePixelRatio
        ),
      onReset: () => this.verlet.reset()
    });

    this.gui = new GuiWrapper(
      this.controls,
      {
        particleCount: this.verlet.particleCount,
        substeps: this.verlet.substeps,
        simWidth: SIMULATION_WIDTH,
        simHeight: SIMULATION_HEIGHT
      },
      () => this.verlet.reset()
    );
  }

  // ↙️ Match the canvas backing store to its displayed size
  resizeCanvas() {
    this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;
    this.target.resize(this.canvas.width, this.canvas.height);
  }

  async render() {
    let lastFrameMS = Date.now();

    do {
      const now = Date.now();
      const elapsed = (now - lastFrameMS) / 1000;
      // Never simulate more than one 60 Hz frame at a time
      const frameTime = Math.min(elapsed, 1 / 60);
      lastFrameMS = now;

      this.gui.updateFPS(1 / elapsed);

      const input = this.controls.frameInput();
      const commandEncoder = this.device.createCommandEncoder();

      if (!this.controls.paused) {
        this.verlet.step(commandEncoder, frameTime, input);
      }

      this.target.render(
        commandEncoder,
        () => this.context.getCurrentTexture().createView(),
        (pass) => this.verlet.draw(pass)
      );

      this.queue.submit([commandEncoder.finish()]);

      this.tickInputs();

      // vsync
      await this.sleep();
    } while (this.running);
  }

  sleep() {
    return new Promise(requestAnimationFrame);
  }
}
