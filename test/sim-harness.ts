// Imported first: it defines the WebGPU globals the source modules need at load.
import { getDevice } from './gpu';

import { afterEach } from 'vitest';

import { fitCamera, simulationSize, STARTING_BOUNDARY_RADIUS } from '../src/camera';
import { SEED_RADIUS } from '../src/verlet/capacity';
import { Particle, SeedParticle } from '../src/verlet/particle-layout';
import { DEFAULT_COLLISION_SETTINGS } from '../src/verlet/collision';
import { BinGridContents, DEFAULT_CAPACITY, scatter, Verlet } from '../src/verlet/verlet';

export type { BinGridContents };

/**
 * The test surface for the simulation. Tests place particles, advance them
 * by a number of substeps and read particles back; everything about how the simulation is
 * constructed and driven stays in this file.
 */

/** The side of simulation space for the app's starting boundary circle: 2160. */
export const BOUNDS = simulationSize(STARTING_BOUNDARY_RADIUS);
/** The radius the app seeds and spawns particles with. */
export const RADIUS = SEED_RADIUS;
/** 20 substeps per 60 Hz frame: half the app's default substep rate. */
export const SUBSTEP_RATE = 1200;
// Substeps encoded into one submitted command buffer, as one 60 Hz frame does.
const SUBSTEPS_PER_SUBMIT = 20;

export interface TestParticle {
  x: number;
  y: number;
  /** Velocity in simulation units per second. Defaults to 0, i.e. at rest. */
  vx?: number;
  vy?: number;
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
  /** Defaults to the origin. */
  constrainCenter?: [number, number];
  classicConstrain?: boolean;
  collide?: boolean;
  /** Substeps per second of simulated time. Defaults to SUBSTEP_RATE. */
  substepRate?: number;
  /** The collision settings. Each defaults to the app's. */
  relaxation?: number;
  particleRestitution?: number;
  particleDamping?: number;
}

export interface Sim {
  device: GPUDevice;
  /** The number of live particles. */
  readonly count: number;
  /**
   * Spawns particles, each with a particle id not used before, up to the
   * simulation's capacity. Returns how many were added.
   */
  spawn(particles: TestParticle[]): number;
  /**
   * Erases the particles whose centres are within `radius` of (x, y). It takes
   * effect at once; it resolves with how many it erased once that has been
   * read back. `count` stops counting them after that and a substep.
   */
  erase(x: number, y: number, radius: number): Promise<number>;
  /**
   * Releases the simulation's GPU resources before the test ends, as the app
   * does when it restarts the simulation. Nothing may use it afterwards.
   */
  destroy(): void;
  /** Advances the simulation by a whole number of substeps. */
  step(substeps: number, input?: SimInput): void;
  read(): Promise<ParticleState[]>;
  reset(): void;
  /**
   * Runs only a bin grid build and returns what it left behind, the particles
   * in the order they sit in memory.
   */
  readBinGrid(): Promise<BinGridContents>;
  /**
   * Draws the particles to a width x height canvas, fitted by the camera as
   * the app does each frame. Returns a lookup for the [r, g, b] bytes of a
   * pixel.
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
    random: mulberry32(seed)
  });
}

// Sims are released as soon as the test that made them ends, since the
// largest hold hundreds of MB of particle and bin buffers.
const live: (() => Promise<void>)[] = [];
afterEach(async () => {
  // Every sim is released even when one reports an error.
  const results = await Promise.allSettled(live.splice(0).map((dispose) => dispose()));
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failed) throw failed.reason;
});

export interface SimOptions {
  /** The smallest bin size. Defaults to the largest particle's diameter. */
  minBinSize?: number;
  /**
   * The boundary circle's radius, which sets the size of simulation space and
   * is the default constrain radius of every step. Defaults to the app's.
   */
  boundaryRadius?: number;
  /** The most particles the simulation holds. Defaults to the app's, or the seed's size if larger. */
  capacity?: number;
}

/** A test particle as the simulation takes it, with the harness's defaults filled in. */
function toSeedParticle(p: TestParticle): SeedParticle {
  return {
    x: p.x,
    y: p.y,
    vx: p.vx ?? 0,
    vy: p.vy ?? 0,
    radius: p.radius ?? RADIUS,
    rgb: p.rgb ?? [1, 1, 1]
  };
}

export async function createSim(
  particles: TestParticle[],
  options: SimOptions = {}
): Promise<Sim | null> {
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

  const boundaryRadius = options.boundaryRadius ?? STARTING_BOUNDARY_RADIUS;
  const bounds = simulationSize(boundaryRadius);
  const format = navigator.gpu.getPreferredCanvasFormat();
  const verlet = checked(
    () =>
      new Verlet(device, {
        bounds,
        format,
        minBinSize: options.minBinSize,
        capacity: options.capacity ?? Math.max(particles.length, DEFAULT_CAPACITY),
        seed: () => particles.map(toSeedParticle)
      })
  );

  live.push(async () => {
    try {
      await settle();
    } finally {
      verlet.destroy();
    }
  });
  await settle();

  return {
    device,
    get count() {
      return verlet.particleCount;
    },

    spawn(spawned) {
      return checked(() => verlet.spawn(spawned.map(toSeedParticle)));
    },

    erase(x, y, radius) {
      return checkedRead(() => verlet.erase({ center: [x, y], radius }));
    },

    destroy() {
      verlet.destroy();
    },

    step(substeps, input = {}) {
      for (let done = 0; done < substeps; done += SUBSTEPS_PER_SUBMIT) {
        checked(() => {
          const encoder = device.createCommandEncoder();
          verlet.step(encoder, Math.min(SUBSTEPS_PER_SUBMIT, substeps - done), {
            clickPoint: [input.clickX ?? 0, input.clickY ?? 0],
            clickForce: input.clickForce ?? 0,
            constrainRadius: input.constrainRadius ?? boundaryRadius,
            constrainCenter: input.constrainCenter,
            classicConstrain: input.classicConstrain ?? false,
            collide: input.collide ?? true,
            substepRate: input.substepRate ?? SUBSTEP_RATE,
            relaxation: input.relaxation ?? DEFAULT_COLLISION_SETTINGS.relaxation,
            particleRestitution:
              input.particleRestitution ?? DEFAULT_COLLISION_SETTINGS.particleRestitution,
            particleDamping: input.particleDamping ?? DEFAULT_COLLISION_SETTINGS.particleDamping
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

    readBinGrid() {
      checked(() => {
        const encoder = device.createCommandEncoder();
        verlet.encodeBinGridBuild(encoder);
        device.queue.submit([encoder.finish()]);
      });
      return checkedRead(() => verlet.readBinGrid());
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

        const encoder = device.createCommandEncoder();
        verlet.draw(encoder, canvas.createView(), fitCamera(bounds, width, height));
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
  /** In simulation units per second. */
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
    if (!Number.isFinite(p.x + p.y + p.vx + p.vy)) s.nonFinite++;
    const d = Math.hypot(p.x, p.y);
    s.centreX += p.x / n;
    s.centreY += p.y / n;
    s.meanDistance += d / n;
    s.maxDistance = Math.max(s.maxDistance, d);
    s.meanSpeed += Math.hypot(p.vx, p.vy) / n;
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
