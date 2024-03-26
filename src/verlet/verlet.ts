import { stepCount } from "../renderer";
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

  dataNumFloats: number;
  dataArray: Float32Array;

  renderer: VerletRenderer;
  computer: VerletBinComputer;

  bounds: number;
  buffer: GPUBuffer;
  
  maxRadius = 1;
  minRadius = 1;

  constructor(bounds: number, globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice) {
    this.bounds = bounds;

    this.objectCount = 200000;
    // 0, 1, 2, 3,    4, 5, 6, 7,        8, 9, 10, 11,    12, 13, 14, 15,    16, 17, 18, 19,          
    // vec4<f32> pos, vec4<f32> prevPos, vec4<f32> accel, vec4<f32> rgbR,    vec4<f32> collisionOffset
    this.dataNumFloats = 20;
    this.dataArray = new Float32Array(this.dataNumFloats * this.objectCount);

    let hue = Math.random();
    let lerpStart = Math.random();
    let lerpEnd = Math.random();
    if (lerpEnd < lerpStart) {
      let temp = lerpEnd;
      lerpEnd = lerpStart;
      lerpStart = temp;
    }
  
    for (let i = 0; i < this.objectCount * this.dataNumFloats; ) {
      const xpos = (Math.random() * bounds)  - (bounds / 2);
      const ypos = (Math.random() * bounds) - (bounds / 2);
      this.dataArray[i] = xpos;
      this.dataArray[i+1] = ypos;
      this.dataArray[i+4] = xpos + (((Math.random() - 0.5) * 12) / stepCount);
      this.dataArray[i+5] = ypos + (((Math.random() - 0.5) * 12) / stepCount);
  
      const rgb = HSVtoRGB(hue, lerp(lerpStart, lerpEnd, Math.random()), 1);
      // const rgb = HSVtoRGB( Math.random(), 1, 1);
  
      this.dataArray[i+12] = rgb.r;
      this.dataArray[i+13] = rgb.g;
      this.dataArray[i+14] = rgb.b;
  
      this.dataArray[i+15] = lerp(this.minRadius, this.maxRadius, Math.random());
      i += this.dataNumFloats;
    }

    this.renderer = new VerletRenderer(globalUniformBindGroupLayout, device);
    this.computer = new VerletBinComputer(globalUniformBindGroupLayout, device);

    this.initBuffers(device);
  }

  initBuffers(device: GPUDevice) {
    this.buffer = device.createBuffer({
      size: this.dataArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.buffer.getMappedRange()).set(this.dataArray);
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
    let hue = Math.random();
    let lerpStart = Math.random();
    let lerpEnd = Math.random();
    if (lerpEnd < lerpStart) {
      let temp = lerpEnd;
      lerpEnd = lerpStart;
      lerpStart = temp;
    }

    for (let i = 0; i < this.objectCount * this.dataNumFloats; ) {
      const xpos = (Math.random() * this.bounds)  - (this.bounds / 2);
      const ypos = (Math.random() * this.bounds) - (this.bounds / 2);
      this.dataArray[i] = xpos;
      this.dataArray[i+1] = ypos;
      this.dataArray[i+4] = xpos + (((Math.random() - 0.5) * 12) / stepCount);
      this.dataArray[i+5] = ypos + (((Math.random() - 0.5) * 12) / stepCount);
  
      const rgb = HSVtoRGB(hue, lerp(lerpStart, lerpEnd, Math.random()), 1);
      // const rgb = HSVtoRGB( Math.random(), 1, 1);
  
      this.dataArray[i+12] = rgb.r;
      this.dataArray[i+13] = rgb.g;
      this.dataArray[i+14] = rgb.b;
  
      this.dataArray[i+15] = lerp(this.minRadius, this.maxRadius, Math.random());
      i += this.dataNumFloats;
    }

    device.queue.writeBuffer(this.buffer, 0, this.dataArray);
  }
}
