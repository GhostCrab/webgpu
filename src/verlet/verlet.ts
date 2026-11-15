import { DEFAULT_SUBSTEP_RATE } from '../clock';
import type { DrawTarget } from '../simulation-target';
import { CollisionSettings, DEFAULT_COLLISION_SETTINGS } from './collision';
import { BinGridContents, CompactPipeline } from './compact-pipeline';
import { CurrentPipeline } from './current-pipeline';
import { packParams, PARAMS_BYTES, Particle, SeedParticle } from './particle-layout';
import type { Pipeline } from './pipeline';
import type { StageTimer, VerletBinComputer } from './verlet-bin-computer';

export type { StageTimer } from './verlet-bin-computer';
export type { BinGridContents } from './compact-pipeline';

function lerp(a: number, b: number, alpha: number) {
  return a + alpha * (b - a);
}

function HSVtoRGB(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

export interface ScatterOptions {
  count: number;
  /** Particles are scattered over a square of this side, centred on the origin. */
  bounds: number;
  radius: number;
  /** Source of numbers in [0, 1). Defaults to Math.random. */
  random?: () => number;
}

/**
 * The default starting state: a uniform scatter, each particle with a small
 * random velocity and a shade of one random hue.
 */
export function scatter(options: ScatterOptions): SeedParticle[] {
  const { count, bounds, radius } = options;
  // Starting speeds of up to 360 units per second each way.
  const maxSpeed = 360;
  const random = options.random ?? Math.random;

  const hue = random();
  let lerpStart = random();
  let lerpEnd = random();
  if (lerpEnd < lerpStart) {
    [lerpStart, lerpEnd] = [lerpEnd, lerpStart];
  }

  const particles: SeedParticle[] = [];
  for (let i = 0; i < count; i++) {
    const x = random() * bounds - bounds / 2;
    const y = random() * bounds - bounds / 2;
    const vx = (0.5 - random()) * 2 * maxSpeed;
    const vy = (0.5 - random()) * 2 * maxSpeed;
    const rgb = HSVtoRGB(hue, lerp(lerpStart, lerpEnd, random()), 1);
    particles.push({ x, y, vx, vy, radius, rgb });
  }
  return particles;
}

/**
 * The smallest and largest radius among the enabled seeded particles. Rejects
 * a seed the simulation cannot size its buffers and bins from, naming what is
 * wrong with it.
 */
function radiusRange(particles: SeedParticle[]): { smallest: number; largest: number } {
  if (particles.length === 0) {
    throw new Error('seed returned no particles');
  }
  let smallest = Infinity;
  let largest = 0;
  for (const p of particles) {
    if (!Number.isFinite(p.radius) || p.radius < 0) {
      throw new Error(`seed returned a particle with radius ${p.radius}; a radius must be 0 or more`);
    }
    if (p.radius > largest) largest = p.radius;
    if (p.radius > 0 && p.radius < smallest) smallest = p.radius;
  }
  if (largest === 0) {
    throw new Error('seed returned only disabled particles (radius 0), so bins cannot be sized');
  }
  return { smallest, largest };
}

/** Gives each particle its index as its particle id. */
function withIds(particles: SeedParticle[]): Particle[] {
  return particles.map((p, id) => ({ ...p, id }));
}

/**
 * Everything outside the simulation that affects one frame of it. The
 * collision settings apply to the new pipeline only.
 */
export interface SimulationInput extends CollisionSettings {
  /** Where the click force acts, in simulation space. */
  clickPoint: [number, number];
  /** Positive pulls toward the click point, negative pushes away, 0 leaves gravity on. */
  clickForce: number;
  /** Radius of the boundary circle. */
  constrainRadius: number;
  /** Centre of the boundary circle, in simulation space. Defaults to the origin. */
  constrainCenter?: [number, number];
  /** True stops particles at the boundary; false bounces them off it. */
  classicConstrain: boolean;
  /** Whether particles collide with each other. */
  collide: boolean;
  /**
   * Substeps per second of simulated time. It alone sets the length of a
   * substep.
   */
  substepRate: number;
}

/**
 * The current pipeline, or the new one being built beside it (spec #9). The
 * choice goes when the new pipeline replaces the current one.
 */
export type PipelineName = 'current' | 'new';

export interface VerletOptions {
  /** Side of the square region of simulation space that particles may occupy. */
  bounds: number;
  /** Maps simulation space to clip space; a 4x4 matrix. */
  projection: Float32Array;
  /** The render pass configuration that draw() renders into. */
  target: DrawTarget;
  /** Which pipeline advances and draws the particles. Defaults to the current one. */
  pipeline?: PipelineName;
  /**
   * The new pipeline's smallest bin size. Its bin buffers are allocated once,
   * for bins this size; bins are one diameter of the largest particle in use
   * wide, but never smaller. Defaults to the diameter of the largest particle
   * of the first seeding. The current pipeline ignores it.
   */
  minBinSize?: number;
  /**
   * The substep rate the simulation will first be stepped at. The current
   * pipeline holds velocity as a move per substep, so it converts the seed's
   * velocities at this rate. Defaults to the app's default substep rate.
   */
  substepRate?: number;
  /**
   * Produces the starting particles, and is called again by reset(). It must
   * return the same number of particles each time. Defaults to a random
   * scatter of 15,000 particles of radius 1.5. Each particle's id is its
   * index in what the seed returns.
   */
  seed?: () => SeedParticle[];
}

/**
 * The particle simulation: owns the particles on the GPU, advances them and
 * draws them.
 */
export class Verlet {
  readonly particleCount: number;

  private device: GPUDevice;
  private bounds: number;
  private seed: () => SeedParticle[];
  private binSize: number;
  /** The furthest a particle may move in one substep: the smallest radius in use. */
  private speedLimit: number;
  private totalTime = 0;
  /** The substep rate of the latest step, which the default seed scales to. */
  private substepRate = DEFAULT_SUBSTEP_RATE;

  private paramsBuffer: GPUBuffer;
  private pipeline: Pipeline;

  constructor(device: GPUDevice, options: VerletOptions) {
    this.device = device;
    this.bounds = options.bounds;
    this.substepRate = options.substepRate ?? DEFAULT_SUBSTEP_RATE;
    this.seed =
      options.seed ??
      (() => scatter({ count: 15000, bounds: this.bounds, radius: 1.5 }));

    if (!(this.bounds > 0) || !Number.isFinite(this.bounds)) {
      throw new Error(`bounds must be a positive number; got ${this.bounds}`);
    }
    if (!(this.substepRate > 0) || !Number.isFinite(this.substepRate)) {
      throw new Error(`substep rate must be a positive number; got ${this.substepRate}`);
    }

    const particles = this.seed();
    this.particleCount = particles.length;
    const radii = radiusRange(particles);
    // A bin must be at least as wide as the largest particle.
    this.binSize = 2 * radii.largest;
    this.speedLimit = radii.smallest;

    this.paramsBuffer = device.createBuffer({
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    // step() rewrites this every frame; until then the bounds must already be
    // valid, because binning reads them.
    device.queue.writeBuffer(
      this.paramsBuffer,
      0,
      packParams({
        totalTime: 0,
        deltaTime: 0,
        constrainRadius: this.bounds / 2,
        constrainCenter: [0, 0],
        boxDim: this.bounds,
        constrainType: 1,
        speedLimit: this.speedLimit,
        clickPoint: [0, 0, 0],
        ...DEFAULT_COLLISION_SETTINGS
      })
    );

    const Pipeline = options.pipeline === 'new' ? CompactPipeline : CurrentPipeline;
    try {
      this.pipeline = new Pipeline(device, {
        particles: withIds(particles),
        substepRate: this.substepRate,
        bounds: this.bounds,
        binSize: this.binSize,
        minBinSize: options.minBinSize ?? this.binSize,
        paramsBuffer: this.paramsBuffer,
        projection: options.projection,
        target: options.target
      });
    } catch (error) {
      // Nothing outside holds a reference yet, so release what was created.
      this.paramsBuffer.destroy();
      throw error;
    }
  }

  /** The current pipeline's compute stage. Exposed for tests of its binning stage only. */
  get computer(): VerletBinComputer {
    return this.currentPipeline().computer;
  }

  /**
   * Advances the simulation by `substeps` substeps, each 1 / substepRate
   * seconds long, encoding the work into `encoder`.
   *
   * The input applies to every one of them. It reaches the GPU when the
   * encoder is submitted, so call this at most once per submitted encoder.
   *
   * A timer, used by the benchmark, times each stage of every substep with
   * timestamp queries. It changes how the work is split into passes, not what
   * the substeps do.
   */
  step(encoder: GPUCommandEncoder, substeps: number, input: SimulationInput, timer?: StageTimer) {
    if (!Number.isInteger(substeps) || substeps < 0) {
      throw new Error(`substeps must be a whole number, 0 or more; got ${substeps}`);
    }
    const { substepRate } = input;
    if (!(substepRate > 0) || !Number.isFinite(substepRate)) {
      throw new Error(`substep rate must be a positive number; got ${substepRate}`);
    }
    if (substeps === 0) return;

    this.substepRate = substepRate;
    this.totalTime += substeps / substepRate;
    this.device.queue.writeBuffer(
      this.paramsBuffer,
      0,
      packParams({
        totalTime: this.totalTime,
        deltaTime: 1 / substepRate,
        constrainRadius: input.constrainRadius,
        constrainCenter: input.constrainCenter ?? [0, 0],
        boxDim: this.bounds,
        constrainType: input.classicConstrain ? 0 : 1,
        speedLimit: this.speedLimit,
        clickPoint: [input.clickPoint[0], input.clickPoint[1], input.clickForce],
        relaxation: input.relaxation,
        particleRestitution: input.particleRestitution,
        particleDamping: input.particleDamping
      })
    );

    for (let i = 0; i < substeps; i++) {
      this.pipeline.encodeSubstep(encoder, input.collide, timer);
    }
  }

  /** Draws the particles into a pass matching the configured draw target. */
  draw(pass: GPURenderPassEncoder) {
    this.pipeline.draw(pass);
  }

  /** Puts the particles back to a fresh starting state from the seed. */
  reset() {
    const particles = this.seed();
    if (particles.length !== this.particleCount) {
      throw new Error(
        `seed returned ${particles.length} particles; expected ${this.particleCount}`
      );
    }
    const radii = radiusRange(particles);
    this.pipeline.write(withIds(particles), this.substepRate);
    this.speedLimit = radii.smallest;
  }

  /** Reads the current particles back from the GPU, ordered by particle id. */
  readParticles(): Promise<Particle[]> {
    return this.pipeline.read(this.substepRate);
  }

  /**
   * Encodes only the new pipeline's bin grid build. Exposed for tests of the
   * build on its own.
   */
  encodeBinGridBuild(encoder: GPUCommandEncoder) {
    this.compactPipeline().encodeBinGridBuild(encoder);
  }

  /**
   * What the new pipeline's latest bin grid build left behind. Exposed for
   * tests of the build on its own.
   */
  readBinGrid(): Promise<BinGridContents> {
    return this.compactPipeline().readBinGrid();
  }

  /** The raw contents of the current pipeline's particle buffer. */
  readParticleBuffer(): Promise<ArrayBuffer> {
    return this.currentPipeline().readParticleBuffer();
  }

  /** Releases the GPU resources. The simulation cannot be used afterwards. */
  destroy() {
    this.paramsBuffer.destroy();
    this.pipeline.destroy();
  }

  private compactPipeline(): CompactPipeline {
    if (!(this.pipeline instanceof CompactPipeline)) {
      throw new Error('only the new pipeline has this bin grid');
    }
    return this.pipeline;
  }

  private currentPipeline(): CurrentPipeline {
    if (!(this.pipeline instanceof CurrentPipeline)) {
      throw new Error('only the current pipeline has this binning stage');
    }
    return this.pipeline;
  }
}
