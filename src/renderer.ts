import {
  Camera,
  canvasToSimulation,
  fitCamera,
  simulationSize,
  STARTING_BOUNDARY_RADIUS
} from './camera';
import { Clock, frameRate } from './clock';
import GuiWrapper from './gui-wrapper';
import { bindInputs } from './input-bindings';
import { InteractionPrototype } from './prototype-interactions';
import { SimulationControls } from './simulation-controls';
import { randomPalette } from './verlet/palette';
import { defaultSeed, Verlet } from './verlet/verlet';

const SIMULATION_SIZE = simulationSize(STARTING_BOUNDARY_RADIUS);

/** Owns the canvas and the frame loop, and wires the other modules together. */
export default class Renderer {
  canvas: HTMLCanvasElement;

  // ⚙️ API Data Structures
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;
  context: GPUCanvasContext;
  /** The canvas's texture format, which the simulation draws in. */
  format: GPUTextureFormat;

  running = true;

  controls: SimulationControls;
  clock = new Clock();
  camera: Camera = fitCamera(SIMULATION_SIZE, 0, 0);
  verlet: Verlet;
  gui: GuiWrapper;
  tickInputs: () => void;
  /** PROTOTYPE (interactions). */
  prototype: InteractionPrototype;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.controls = new SimulationControls({ constrainRadius: STARTING_BOUNDARY_RADIUS });
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

  // 🍱 Initialize resources (swapchain, the simulation, inputs)
  initializeResources() {
    this.format = navigator.gpu.getPreferredCanvasFormat();

    // ⛓️ Swapchain
    this.context = this.canvas.getContext('webgpu');
    this.context.configure({
      device: this.device,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: 'premultiplied'
    });

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.verlet = this.createSimulation();

    const toSimulation = (pageX: number, pageY: number) =>
      canvasToSimulation(
        this.camera,
        pageX * window.devicePixelRatio,
        pageY * window.devicePixelRatio
      );
    this.tickInputs = bindInputs(this.controls, {
      toSimulation,
      onReset: () => this.verlet.reset()
    });
    this.prototype = new InteractionPrototype(this.controls, this.canvas, toSimulation);

    this.gui = new GuiWrapper(
      this.controls,
      {
        particleCount: this.verlet.particleCount,
        simulationSize: SIMULATION_SIZE
      },
      () => this.verlet.reset(),
      () => this.restart()
    );
  }

  /**
   * A new simulation, at the capacity the controls hold. Each seeding, the
   * first and every reset, scatters shades of a new random palette, which
   * spawned particles then take too.
   */
  createSimulation(): Verlet {
    const capacity = Math.round(this.controls.capacity);
    return new Verlet(this.device, {
      bounds: SIMULATION_SIZE,
      format: this.format,
      capacity,
      seed: () => {
        const palette = randomPalette();
        this.controls.useSpawnPalette(palette);
        return defaultSeed({ capacity, bounds: SIMULATION_SIZE, palette });
      }
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
    this.camera = fitCamera(SIMULATION_SIZE, this.canvas.width, this.canvas.height);
  }

  async render() {
    // Elapsed time comes from the browser's frame timestamps, in milliseconds.
    let lastFrame = await this.nextFrame();

    do {
      const now = await this.nextFrame();
      const elapsed = (now - lastFrame) / 1000;
      lastFrame = now;

      const input = this.controls.frameInput();
      this.prototype.apply(input, elapsed);
      // Erases and spawned particles reach the GPU before this frame's
      // substeps are encoded. Nothing waits for an erase's count.
      const erase = this.controls.frameErase();
      if (erase) void this.verlet.erase(erase);
      this.verlet.spawn(this.controls.frameSpawn(elapsed));
      const commandEncoder = this.device.createCommandEncoder();

      // While paused the clock does not run, so no time is owed on resuming.
      const tick = this.controls.paused
        ? { substeps: 0, wanted: 0 }
        : this.clock.advance(elapsed, input.substepRate);
      this.verlet.step(commandEncoder, tick.substeps, input);
      this.gui.updateFrame(frameRate(elapsed), tick);
      this.gui.updateParticles(this.verlet.particleCount, this.verlet.capacity);

      // A hidden or collapsed canvas has no area and nothing to draw to.
      if (this.camera.scale > 0) {
        const view = this.context.getCurrentTexture().createView();
        this.verlet.draw(commandEncoder, view, this.camera);
      }
      this.prototype.drawOverlay(this.camera);

      this.queue.submit([commandEncoder.finish()]);

      this.tickInputs();
    } while (this.running);
  }

  /** Waits for the next display refresh and returns its timestamp in milliseconds. */
  nextFrame() {
    return new Promise<DOMHighResTimeStamp>(requestAnimationFrame);
  }
}
