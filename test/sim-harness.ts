import { mat4 } from 'wgpu-matrix';

import { RenderPassDescriptor } from '../src/render-pass-descriptor';
import { Particle, unpackBinLinks } from '../src/verlet/particle-layout';
import { Verlet } from '../src/verlet/verlet';
import { getDevice } from './gpu';

/**
 * The test surface for the simulation. Tests place particles, step whole
 * frames and read particles back; everything about how the simulation is
 * constructed and driven stays in this file.
 */

export const BOUNDS = 2160;
export const RADIUS = 1.5;
export const DEFAULT_CONSTRAIN_RADIUS = BOUNDS / 2 - 20;
export const SUBSTEPS = 20;
export const FRAME_TIME = 1 / 60;


export interface TestParticle {
  x: number;
  y: number;
  /** Defaults to the position, i.e. at rest. */
  prevX?: number;
  prevY?: number;
  radius?: number;
  rgb?: [number, number, number];
}

export type ParticleState = Particle;

export interface SimInput {
  clickX?: number;
  clickY?: number;
  /** Positive attracts, negative repels, 0 means gravity applies. */
  clickForce?: number;
  constrainRadius?: number;
  classicConstrain?: boolean;
  collide?: boolean;
}

export interface Sim {
  device: GPUDevice;
  count: number;
  step(frames: number, input?: SimInput): void;
  read(): Promise<ParticleState[]>;
  reset(): void;
  /** Runs only the binning stage and returns the spatial hash it built. */
  readBinLists(): Promise<{ heads: Int32Array; links: Int32Array }>;
  /**
   * Draws the particles into a width x height image of the whole simulation
   * space and returns a lookup for the [r, g, b] bytes of one pixel.
   */
  render(width: number, height: number): Promise<(x: number, y: number) => number[]>;
}

/** Small deterministic PRNG so seeded runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The app's start state: a uniform scatter over the bounds with a small random velocity. */
export function seededScatter(count: number, seed: number): TestParticle[] {
  const random = mulberry32(seed);
  const particles: TestParticle[] = [];
  for (let i = 0; i < count; i++) {
    const x = random() * BOUNDS - BOUNDS / 2;
    const y = random() * BOUNDS - BOUNDS / 2;
    particles.push({
      x,
      y,
      prevX: x + ((random() - 0.5) * 12) / SUBSTEPS,
      prevY: y + ((random() - 0.5) * 12) / SUBSTEPS,
      radius: RADIUS
    });
  }
  return particles;
}

export async function readBuffer(device: GPUDevice, source: GPUBuffer): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    size: source.size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, source.size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}

export async function createSim(particles: TestParticle[]): Promise<Sim | null> {
  const device = await getDevice();
  if (!device) return null;

  // Same projection as the app: centre origin, y down, fixed 3840x2160 space.
  const simWidth = (BOUNDS * 16) / 9;
  const projection = mat4.ortho(-simWidth / 2, simWidth / 2, BOUNDS / 2, -BOUNDS / 2, 1.05, -1);
  const format = navigator.gpu.getPreferredCanvasFormat();

  const verlet = new Verlet(device, {
    bounds: BOUNDS,
    projection: projection as Float32Array,
    targetFormat: format,
    substeps: SUBSTEPS,
    seed: () =>
      particles.map((p) => ({
        x: p.x,
        y: p.y,
        prevX: p.prevX ?? p.x,
        prevY: p.prevY ?? p.y,
        radius: p.radius ?? RADIUS,
        rgb: p.rgb ?? [1, 1, 1]
      }))
  });

  return {
    device,
    count: particles.length,

    step(frames, input = {}) {
      for (let f = 0; f < frames; f++) {
        const encoder = device.createCommandEncoder();
        verlet.step(encoder, FRAME_TIME, {
          clickPoint: [input.clickX ?? 0, input.clickY ?? 0],
          clickForce: input.clickForce ?? 0,
          constrainRadius: input.constrainRadius ?? DEFAULT_CONSTRAIN_RADIUS,
          classicConstrain: input.classicConstrain ?? false,
          collide: input.collide ?? true
        });
        device.queue.submit([encoder.finish()]);
      }
    },

    read() {
      return verlet.readParticles();
    },

    reset() {
      verlet.reset();
    },

    async readBinLists() {
      const encoder = device.createCommandEncoder();
      verlet.computer.encodeBinning(encoder);
      device.queue.submit([encoder.finish()]);

      const heads = new Int32Array(await readBuffer(device, verlet.computer.binBuffer));
      const links = unpackBinLinks(await verlet.readParticleBuffer());
      return { heads, links };
    },

    async render(width, height) {
      const target = device.createTexture({
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      });
      const passDescriptor = new RenderPassDescriptor(device, width, height);
      passDescriptor.updateResolveTarget(target.createView());

      const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      const staging = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass(passDescriptor);
      verlet.draw(pass);
      pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: staging, bytesPerRow }, [
        width,
        height
      ]);
      device.queue.submit([encoder.finish()]);

      await staging.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(staging.getMappedRange().slice(0));
      staging.unmap();
      const [r, b] = format === 'bgra8unorm' ? [2, 0] : [0, 2];
      return (x, y) => {
        const o = y * bytesPerRow + x * 4;
        return [bytes[o + r], bytes[o + 1], bytes[o + b]];
      };
    }
  };
}

export interface RunStats {
  nonFinite: number;
  centreX: number;
  centreY: number;
  meanDistance: number;
  maxDistance: number;
  meanSpeed: number;
  overlapPairs: number;
  meanOverlap: number;
  maxOverlap: number;
}

/** Aggregate measures of a particle set, robust to per-particle chaos. */
export function runStats(particles: ParticleState[]): RunStats {
  const n = particles.length;
  const xs = Float64Array.from(particles, (p) => p.x);
  const ys = Float64Array.from(particles, (p) => p.y);
  const s: RunStats = {
    nonFinite: 0,
    centreX: 0,
    centreY: 0,
    meanDistance: 0,
    maxDistance: 0,
    meanSpeed: 0,
    overlapPairs: 0,
    meanOverlap: 0,
    maxOverlap: 0
  };
  for (const p of particles) {
    if (!Number.isFinite(p.x + p.y + p.prevX + p.prevY)) s.nonFinite++;
    const d = Math.hypot(p.x, p.y);
    s.centreX += p.x / n;
    s.centreY += p.y / n;
    s.meanDistance += d / n;
    s.maxDistance = Math.max(s.maxDistance, d);
    s.meanSpeed += Math.hypot(p.x - p.prevX, p.y - p.prevY) / n;
  }
  let overlapSum = 0;
  for (let i = 0; i < n; i++) {
    const ri = particles[i].radius;
    for (let j = i + 1; j < n; j++) {
      const min = ri + particles[j].radius;
      const dx = xs[i] - xs[j];
      if (dx > min || dx < -min) continue;
      const dy = ys[i] - ys[j];
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min) {
        const overlap = min - Math.sqrt(d2);
        overlapSum += overlap;
        s.overlapPairs++;
        if (overlap > s.maxOverlap) s.maxOverlap = overlap;
      }
    }
  }
  s.meanOverlap = s.overlapPairs ? overlapSum / s.overlapPairs : 0;
  return s;
}
