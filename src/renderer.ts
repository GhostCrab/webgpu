import { Camera, canvasToSimulation, fitCamera, simulationSize } from './camera';
import { Clock } from './clock';
import GuiWrapper from './gui-wrapper';
import { bindInputs } from './input-bindings';
import { SimulationControls } from './simulation-controls';
import { Verlet } from './verlet/verlet';

// The boundary circle's starting radius. It alone sets the size of simulation
// space, which the camera fits to the canvas.
const BOUNDARY_RADIUS = 1060;
const SIMULATION_SIZE = simulationSize(BOUNDARY_RADIUS);

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
  camera: Camera = fitCamera(SIMULATION_SIZE, 0, 0);
  verlet: Verlet;
  gui: GuiWrapper;
  tickInputs: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.controls = new SimulationControls({ constrainRadius: BOUNDARY_RADIUS });
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
    const format = navigator.gpu.getPreferredCanvasFormat();

    // ⛓️ Swapchain
    this.context = this.canvas.getContext('webgpu');
    this.context.configure({
      device: this.device,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: 'premultiplied'
    });

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.verlet = new Verlet(this.device, { bounds: SIMULATION_SIZE, format });

    this.tickInputs = bindInputs(this.controls, {
      toSimulation: (pageX, pageY) =>
        canvasToSimulation(
          this.camera,
          pageX * window.devicePixelRatio,
          pageY * window.devicePixelRatio
        ),
      onReset: () => this.verlet.reset()
    });

    this.gui = new GuiWrapper(
      this.controls,
      {
        particleCount: this.verlet.particleCount,
        simulationSize: SIMULATION_SIZE
      },
      () => this.verlet.reset()
    );
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
      const commandEncoder = this.device.createCommandEncoder();

      // While paused the clock does not run, so no time is owed on resuming.
      const tick = this.controls.paused
        ? { substeps: 0, wanted: 0 }
        : this.clock.advance(elapsed, input.substepRate);
      this.verlet.step(commandEncoder, tick.substeps, input);
      this.gui.updateFrame(1 / elapsed, tick);

      // A hidden or collapsed canvas has no area and nothing to draw to.
      if (this.camera.scale > 0) {
        const view = this.context.getCurrentTexture().createView();
        this.verlet.draw(commandEncoder, view, this.camera);
      }

      this.queue.submit([commandEncoder.finish()]);

      this.tickInputs();
    } while (this.running);
  }

  /** Waits for the next display refresh and returns its timestamp in milliseconds. */
  nextFrame() {
    return new Promise<DOMHighResTimeStamp>(requestAnimationFrame);
  }
}
