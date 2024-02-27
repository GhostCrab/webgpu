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
  objectRadius: number;
  objectCount: number;

  dataNumFloats: number;
  dataArray: Float32Array;

  renderer: VerletRenderer;

  constructor(bounds: number) {
    this.objectRadius = .3;
    this.objectCount = 3000000;
    // 0, 1, 2, 3,    4, 5, 6, 7,        8, 9, 10, 11,    12, 13, 14, 15,
    // vec4<f32> pos, vec4<f32> prevPos, vec4<f32> accel, vec4<f32> rgbR
    this.dataNumFloats = 16;
    this.dataArray = new Float32Array(this.dataNumFloats * this.objectCount);
  
    for (let i = 0; i < this.objectCount * this.dataNumFloats; ) {
      const xpos = (Math.random() * bounds)  - (bounds / 2);
      const ypos = (Math.random() * bounds) - (bounds / 2);
      this.dataArray[i] = xpos;
      this.dataArray[i+1] = ypos;
      this.dataArray[i+4] = xpos;
      this.dataArray[i+5] = ypos;
  
      const rgb = HSVtoRGB(0, lerp(0.6, 0.9, Math.random()), 1);
  
      this.dataArray[i+12] = rgb.r;
      this.dataArray[i+13] = rgb.g;
      this.dataArray[i+14] = rgb.b;
  
      this.dataArray[i+15] = this.objectRadius;
      i += this.dataNumFloats;
    }
  }

  initRenderer(layout: GPUPipelineLayout, device: GPUDevice) {
    this.renderer = new VerletRenderer(layout, device);
    this.renderer.initBuffers(device, this.dataArray, this.objectCount);
  }

  render(passEncoder: GPURenderPassEncoder, frame: number) {
    this.renderer.render(passEncoder, frame);
  }
}
