import { stepCount } from "../renderer";
import { packParticles, Particle } from "./particle-layout";
import { VerletBinComputer } from "./verlet-bin-computer";
import { VerletRenderer } from "./verlet-renderer";

function lerp(a: number, b: number, alpha: number) {
  return a + alpha * (b - a);
}

function HSVtoRGB(h: number, s: number, v: number) {
  let r: number, g: number, b: number, 
      i: number, f: number, p: number, 
      q: number, t: number;

  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);
  switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
  }

  return { r, g, b };
}

export class Verlet {
  objectCount: number;

  renderer: VerletRenderer;
  computer: VerletBinComputer;

  bounds: number;
  buffer: GPUBuffer;

  minRadius = 1.5;
  maxRadius = this.minRadius;
  // maxRadius = 150;

  constructor(bounds: number, globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice) {
    this.bounds = bounds;

    this.objectCount = 15000;

    this.renderer = new VerletRenderer(globalUniformBindGroupLayout, device);
    this.computer = new VerletBinComputer(globalUniformBindGroupLayout, device);

    this.initBuffers(device);
  }

  /**
   * A uniform scatter over the bounds: each particle gets a small random
   * velocity and a shade of one random hue.
   */
  scatter(): Particle[] {
    let hue = Math.random();
    let lerpStart = Math.random();
    let lerpEnd = Math.random();
    if (lerpEnd < lerpStart) {
      let temp = lerpEnd;
      lerpEnd = lerpStart;
      lerpStart = temp;
    }

    const particles: Particle[] = [];
    for (let i = 0; i < this.objectCount; i++) {
      const x = (Math.random() * this.bounds) - (this.bounds / 2);
      const y = (Math.random() * this.bounds) - (this.bounds / 2);
      const prevX = x + (((Math.random() - 0.5) * 12) / stepCount);
      const prevY = y + (((Math.random() - 0.5) * 12) / stepCount);

      const { r, g, b } = HSVtoRGB(hue, lerp(lerpStart, lerpEnd, Math.random()), 1);
      const radius = lerp(this.minRadius, this.maxRadius, Math.random());

      particles.push({ x, y, prevX, prevY, radius, rgb: [r, g, b] });
    }
    return particles;
  }

  initBuffers(device: GPUDevice) {
    const data = packParticles(this.scatter());
    this.buffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Float32Array(this.buffer.getMappedRange()).set(data);
    this.buffer.unmap();

    this.computer.initBuffers(device, this.bounds, this.objectCount, this.maxRadius, this.buffer);
  }

  render(passEncoder: GPURenderPassEncoder) {
    this.renderer.render(passEncoder, this.buffer, this.objectCount);
  }

  compute(device: GPUDevice, commandEncoder: GPUCommandEncoder, globalUniformBindGroup: GPUBindGroup, doCollision: boolean) {
    this.computer.compute(device, commandEncoder, globalUniformBindGroup, doCollision);
  }

  reset(device: GPUDevice) {
    device.queue.writeBuffer(this.buffer, 0, packParticles(this.scatter()));
  }
}
