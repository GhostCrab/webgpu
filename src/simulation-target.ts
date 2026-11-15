import { mat4 } from 'wgpu-matrix';

import { canvasToSimulation, fitViewport, Viewport } from './letterbox';
import presentWGSL from './shaders/fullscreenTexturedQuad.wgsl';

const SAMPLE_COUNT = 4;
const DEPTH_STENCIL_FORMAT: GPUTextureFormat = 'depth24plus-stencil8';

/** What a pipeline must match to draw into a render pass. */
export interface DrawTarget {
  format: GPUTextureFormat;
  sampleCount: number;
  depthStencilFormat: GPUTextureFormat;
}

export interface SimulationTargetOptions {
  /** Size of simulation space, which is also the size of the image in pixels. */
  width: number;
  height: number;
  /** Format of the canvas the image is presented to. */
  format: GPUTextureFormat;
}

/** A multisampled colour attachment and its depth attachment, resolved to a view chosen per frame. */
class MultisampledPass implements GPURenderPassDescriptor {
  colorAttachments: GPURenderPassColorAttachment[];
  depthStencilAttachment: GPURenderPassDepthStencilAttachment;
  private colorTexture: GPUTexture;
  private depthTexture: GPUTexture;

  constructor(device: GPUDevice, width: number, height: number, format: GPUTextureFormat) {
    this.colorTexture = device.createTexture({
      size: [width, height],
      sampleCount: SAMPLE_COUNT,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthTexture = device.createTexture({
      size: [width, height, 1],
      sampleCount: SAMPLE_COUNT,
      dimension: '2d',
      format: DEPTH_STENCIL_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    this.colorAttachments = [
      {
        view: this.colorTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }
    ];
    this.depthStencilAttachment = {
      view: this.depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      stencilClearValue: 0,
      stencilLoadOp: 'clear',
      stencilStoreOp: 'store'
    };
  }

  resolveTo(view: GPUTextureView): this {
    this.colorAttachments[0].resolveTarget = view;
    return this;
  }

  destroy() {
    this.colorTexture.destroy();
    this.depthTexture.destroy();
  }
}

/**
 * The simulation target: the fixed-size image the simulation is drawn into,
 * and its presentation to a canvas of any size with the aspect ratio kept.
 */
export class SimulationTarget {
  /** What pipelines drawing the simulation must match. */
  readonly drawTarget: DrawTarget;
  /** Maps simulation space (centre origin, y down) to clip space. */
  readonly projection: Float32Array;

  private device: GPUDevice;
  private width: number;
  private height: number;
  private format: GPUTextureFormat;

  private image: GPUTexture;
  private imagePass: MultisampledPass;
  /** Undefined while the canvas has no area, when there is nothing to present to. */
  private canvasPass: MultisampledPass | undefined;
  private resized = false;
  private viewport: Viewport = { x: 0, y: 0, width: 1, height: 1 };

  private presentPipeline: GPURenderPipeline;
  private presentBindGroup: GPUBindGroup;

  constructor(device: GPUDevice, options: SimulationTargetOptions) {
    this.device = device;
    this.width = options.width;
    this.height = options.height;
    this.format = options.format;

    this.drawTarget = {
      format: this.format,
      sampleCount: SAMPLE_COUNT,
      depthStencilFormat: DEPTH_STENCIL_FORMAT
    };

    this.projection = mat4.ortho(
      -this.width / 2,
      this.width / 2,
      this.height / 2,
      -this.height / 2,
      1.05,
      -1
    ) as Float32Array;

    this.image = device.createTexture({
      size: [this.width, this.height],
      format: this.format,
      usage:
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING
    });
    this.imagePass = new MultisampledPass(device, this.width, this.height, this.format);

    const presentModule = device.createShaderModule({ code: presentWGSL });
    this.presentPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: presentModule, entryPoint: 'vert_main' },
      fragment: {
        module: presentModule,
        entryPoint: 'frag_main',
        targets: [{ format: this.format }]
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: DEPTH_STENCIL_FORMAT
      },
      multisample: { count: SAMPLE_COUNT }
    });

    this.presentBindGroup = device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
        },
        { binding: 1, resource: this.image.createView() }
      ]
    });
  }

  /**
   * Call with the canvas size in pixels, at the start and whenever it changes.
   * A hidden or collapsed canvas reports a size of 0; presentation is then
   * skipped until it has an area again.
   */
  resize(canvasWidth: number, canvasHeight: number) {
    const width = Number.isFinite(canvasWidth) ? Math.max(0, Math.floor(canvasWidth)) : 0;
    const height = Number.isFinite(canvasHeight) ? Math.max(0, Math.floor(canvasHeight)) : 0;

    // Build the replacement before releasing the old pass, so a failure here
    // leaves the target as it was.
    const next =
      width > 0 && height > 0
        ? new MultisampledPass(this.device, width, height, this.format)
        : undefined;

    this.canvasPass?.destroy();
    this.canvasPass = next;
    this.viewport = fitViewport(this.width, this.height, width, height);
    this.resized = true;
  }

  /** Maps a point in canvas pixels to simulation space. */
  toSimulation(canvasX: number, canvasY: number): [number, number] {
    return canvasToSimulation(this.viewport, this.width, this.height, canvasX, canvasY);
  }

  /**
   * Encodes one frame: `draw` renders the simulation into the image, which is
   * then presented, letterboxed, to the view `canvasView` returns. Requires a
   * prior resize(). While the canvas has no area nothing is encoded and
   * neither callback is called.
   */
  render(
    encoder: GPUCommandEncoder,
    canvasView: () => GPUTextureView,
    draw: (pass: GPURenderPassEncoder) => void
  ) {
    if (!this.resized) {
      throw new Error('SimulationTarget.resize() must be called before render()');
    }
    if (!this.canvasPass) {
      return;
    }

    const imagePass = encoder.beginRenderPass(this.imagePass.resolveTo(this.image.createView()));
    draw(imagePass);
    imagePass.end();

    const present = encoder.beginRenderPass(this.canvasPass.resolveTo(canvasView()));
    const { x, y, width, height } = this.viewport;
    present.setViewport(x, y, width, height, 0, 1);
    present.setScissorRect(Math.floor(x), Math.floor(y), Math.floor(width), Math.floor(height));
    present.setPipeline(this.presentPipeline);
    present.setBindGroup(0, this.presentBindGroup);
    present.draw(6);
    present.end();
  }

  /** Releases the GPU resources. The target cannot be used afterwards. */
  destroy() {
    this.image.destroy();
    this.imagePass.destroy();
    this.canvasPass?.destroy();
  }
}
