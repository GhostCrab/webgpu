// Imported first: it defines the WebGPU globals the source modules need at load.
import { getDevice } from './gpu';

import { afterEach } from 'vitest';

import { readBuffer } from '../src/read-buffer';
import { SimulationTarget } from '../src/simulation-target';
import { Particle, unpackBinLinks } from '../src/verlet/particle-layout';
import { scatter, Verlet } from '../src/verlet/verlet';

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
   * Draws the particles and presents them to a width x height canvas, as the
   * app does each frame. Returns a lookup for the [r, g, b] bytes of a pixel.
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

/** The app's own start state, from its scatter function, made reproducible by a seed. */
export function seededScatter(count: number, seed: number): TestParticle[] {
  return scatter({
    count,
    bounds: BOUNDS,
    radius: RADIUS,
    substeps: SUBSTEPS,
    random: mulberry32(seed)
  });
}

// Each sim holds a full-size simulation target, several hundred MB of GPU
// memory, so sims are released as soon as the test that made them ends.
const live: (() => Promise<void>)[] = [];
afterEach(async () => {
  // Every sim is released even when one reports an error.
  const results = await Promise.allSettled(live.splice(0).map((dispose) => dispose()));
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failed) throw failed.reason;
});

export async function createSim(particles: TestParticle[]): Promise<Sim | null> {
  const device = await getDevice();
  if (!device) return null;

  // WebGPU reports validation errors asynchronously. Every GPU operation the
  // harness performs runs inside an error scope, and the scopes are checked
  // whenever a test reads a result and again when the test ends, so an error
  // fails the test that caused it.
  const scopes: Promise<GPUError | null>[] = [];
  function checked<T>(operation: () => T): T {
    device.pushErrorScope('validation');
    try {
      return operation();
    } finally {
      scopes.push(device.popErrorScope());
    }
  }
  async function settle() {
    for (const error of await Promise.all(scopes.splice(0))) {
      if (error) throw new Error(`WebGPU validation error: ${error.message}`);
    }
  }
  // A readback creates a buffer and submits a copy before its first await, so
  // starting it inside a scope covers those. A validation error is reported in
  // preference to the opaque map failure it would cause.
  async function checkedRead<T>(read: () => Promise<T>): Promise<T> {
    const pending = checked(read);
    pending.catch(() => {});
    await settle();
    return pending;
  }

  // The app's simulation space: 3840x2160, centre origin, y down.
  const format = navigator.gpu.getPreferredCanvasFormat();
  const { target, verlet } = checked(() => {
    const target = new SimulationTarget(device, {
      width: (BOUNDS * 16) / 9,
      height: BOUNDS,
      format
    });
    try {
      const verlet = new Verlet(device, {
        bounds: BOUNDS,
        projection: target.projection,
        target: target.drawTarget,
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
      return { target, verlet };
    } catch (error) {
      target.destroy();
      throw error;
    }
  });

  live.push(async () => {
    try {
      await settle();
    } finally {
      verlet.destroy();
      target.destroy();
    }
  });
  await settle();

  return {
    device,
    count: particles.length,

    step(frames, input = {}) {
      for (let f = 0; f < frames; f++) {
        checked(() => {
          const encoder = device.createCommandEncoder();
          verlet.step(encoder, FRAME_TIME, {
            clickPoint: [input.clickX ?? 0, input.clickY ?? 0],
            clickForce: input.clickForce ?? 0,
            constrainRadius: input.constrainRadius ?? DEFAULT_CONSTRAIN_RADIUS,
            classicConstrain: input.classicConstrain ?? false,
            collide: input.collide ?? true
          });
          device.queue.submit([encoder.finish()]);
        });
      }
    },

    read() {
      return checkedRead(() => verlet.readParticles());
    },

    reset() {
      checked(() => verlet.reset());
    },

    async readBinLists() {
      checked(() => {
        const encoder = device.createCommandEncoder();
        verlet.computer.encodeBinning(encoder);
        device.queue.submit([encoder.finish()]);
      });

      const heads = new Int32Array(
        await checkedRead(() => readBuffer(device, verlet.computer.binBuffer))
      );
      const links = unpackBinLinks(await checkedRead(() => verlet.readParticleBuffer()));
      return { heads, links };
    },

    async render(width, height) {
      const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      const { canvas, staging } = checked(() => {
        const canvas = device.createTexture({
          size: [width, height],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        });
        const staging = device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        target.resize(width, height);
        const encoder = device.createCommandEncoder();
        target.render(encoder, () => canvas.createView(), (pass) => verlet.draw(pass));
        encoder.copyTextureToBuffer({ texture: canvas }, { buffer: staging, bytesPerRow }, [
          width,
          height
        ]);
        device.queue.submit([encoder.finish()]);
        return { canvas, staging };
      });

      let bytes: Uint8Array;
      try {
        await settle();
        await staging.mapAsync(GPUMapMode.READ);
        bytes = new Uint8Array(staging.getMappedRange().slice(0));
        staging.unmap();
      } finally {
        staging.destroy();
        canvas.destroy();
      }

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
