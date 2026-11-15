import { readBuffer } from '../read-buffer';
import { packParticles, Particle, particleInstanceLayout, unpackParticles } from './particle-layout';
import type { Pipeline, PipelineOptions } from './pipeline';
import vertexShader from './shaders/verlet-renderer.wgsl';
import { StageTimer, VerletBinComputer } from './verlet-bin-computer';
import { VerletRenderer } from './verlet-renderer';

/**
 * The current pipeline: position Verlet over the VerletObject particle, with
 * the linked-list bin grid and the four-pass collide.
 */
export class CurrentPipeline implements Pipeline {
  /** The compute stage. Exposed for tests of the binning stage only. */
  readonly computer: VerletBinComputer;

  private device: GPUDevice;
  private particleCount: number;
  private binSize: number;
  private particleBuffer: GPUBuffer;
  private renderer: VerletRenderer;

  constructor(device: GPUDevice, options: PipelineOptions) {
    this.device = device;
    this.particleCount = options.particles.length;
    this.binSize = options.binSize;

    const data = packParticles(options.particles, options.substepRate);
    this.particleBuffer = device.createBuffer({
      size: data.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC
    });
    device.queue.writeBuffer(this.particleBuffer, 0, data);

    try {
      this.computer = new VerletBinComputer(device, {
        bounds: options.bounds,
        binSize: options.binSize,
        particleCount: this.particleCount,
        particleBuffer: this.particleBuffer,
        paramsBuffer: options.paramsBuffer
      });

      this.renderer = new VerletRenderer(device, {
        projection: options.projection,
        target: options.target,
        vertexShader,
        instanceLayout: particleInstanceLayout(2, 3)
      });
    } catch (error) {
      // Nothing outside holds a reference yet, so release what was created.
      this.particleBuffer.destroy();
      this.computer?.destroy();
      throw error;
    }
  }

  write(particles: Particle[], substepRate: number) {
    // The bins keep the size they were built with.
    if (particles.some((p) => 2 * p.radius > this.binSize)) {
      throw new Error('seed returned a particle larger than the bins were sized for');
    }
    this.device.queue.writeBuffer(this.particleBuffer, 0, packParticles(particles, substepRate));
  }

  encodeSubstep(encoder: GPUCommandEncoder, collide: boolean, timer?: StageTimer) {
    this.computer.encodeSubstep(encoder, collide, timer);
  }

  async read(substepRate: number): Promise<Particle[]> {
    return unpackParticles(await this.readParticleBuffer(), substepRate);
  }

  /** The raw contents of the particle buffer. */
  readParticleBuffer(): Promise<ArrayBuffer> {
    return readBuffer(this.device, this.particleBuffer);
  }

  draw(pass: GPURenderPassEncoder) {
    this.renderer.render(pass, this.particleBuffer, this.particleCount);
  }

  destroy() {
    this.particleBuffer.destroy();
    this.computer.destroy();
    this.renderer.destroy();
  }
}
