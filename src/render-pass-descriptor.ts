export class RenderPassDescriptor implements GPURenderPassDescriptor {
  colorTexture: GPUTexture;
  colorTextureView: GPUTextureView;
  depthTexture: GPUTexture;
  depthTextureView: GPUTextureView;

  colorAttachments: GPURenderPassColorAttachment[];
  depthStencilAttachment: GPURenderPassDepthStencilAttachment;  

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    const sampleCount = 4;

    this.colorTexture = device.createTexture({
      label: 'rps-colorTexture',
      size: [canvas.width, canvas.height],
      sampleCount: sampleCount,
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.colorTextureView = this.colorTexture.createView();

    this.depthTexture = device.createTexture({
      label: 'rps-depthTexture',
      size: [canvas.width, canvas.height, 1],
      sampleCount: sampleCount,
      dimension: '2d',
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthTextureView = this.depthTexture.createView();

    this.colorAttachments = [{
      view: this.colorTextureView,
      clearValue: { r: 0.0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }];

    this.depthStencilAttachment = {
      view: this.depthTextureView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      stencilClearValue: 0,
      stencilLoadOp: 'clear',
      stencilStoreOp: 'store'
    };
  }

  updateResolveTarget(target: GPUTextureView) {
    this.colorAttachments[0].resolveTarget = target;
  }
}