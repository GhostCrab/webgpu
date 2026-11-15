import { Clock } from './clock';
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
  clock = new Clock();
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

    this.verlet = this.createSimulation();

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
        simWidth: SIMULATION_WIDTH,
        simHeight: SIMULATION_HEIGHT
      },
      () => this.verlet.reset(),
      () => this.restart()
    );
  }

  /** A new simulation, at the capacity the controls hold. */
  createSimulation(): Verlet {
    return new Verlet(this.device, {
      bounds: SIMULATION_HEIGHT,
      projection: this.target.projection,
      target: this.target.drawTarget,
      capacity: Math.round(this.controls.capacity)
    });
  }

  /** Replaces the simulation with a fresh one, as on a change of capacity. */
  restart() {
    this.verlet.destroy();
    this.verlet = this.createSimulation();
  }

  // ↙️ Match the canvas backing store to its displayed size
  resizeCanvas() {
    this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;
    this.target.resize(this.canvas.width, this.canvas.height);
  }

  async render() {
    // Elapsed time comes from the browser's frame timestamps, in milliseconds.
    let lastFrame = await this.nextFrame();

    do {
      const now = await this.nextFrame();
      const elapsed = (now - lastFrame) / 1000;
      lastFrame = now;

      const input = this.controls.frameInput();
      // Spawned particles are written before this frame's substeps are encoded.
      this.verlet.spawn(this.controls.frameSpawn(elapsed));
      const commandEncoder = this.device.createCommandEncoder();

      // While paused the clock does not run, so no time is owed on resuming.
      const tick = this.controls.paused
        ? { substeps: 0, wanted: 0 }
        : this.clock.advance(elapsed, input.substepRate);
      this.verlet.step(commandEncoder, tick.substeps, input);
      this.gui.updateFrame(1 / elapsed, tick);
      this.gui.updateParticles(this.verlet.particleCount, this.verlet.capacity);

      this.target.render(
        commandEncoder,
        () => this.context.getCurrentTexture().createView(),
        (pass) => this.verlet.draw(pass)
      );

      this.queue.submit([commandEncoder.finish()]);

      this.tickInputs();
    } while (this.running);
  }

  /** Waits for the next display refresh and returns its timestamp in milliseconds. */
  nextFrame() {
    return new Promise<DOMHighResTimeStamp>(requestAnimationFrame);
  }
}
