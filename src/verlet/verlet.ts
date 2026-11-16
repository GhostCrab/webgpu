import { Camera, cameraProjection } from '../camera';
import { checkSubstepRate } from '../clock';
import { DEFAULT_CAPACITY, MAX_RADIUS_RATIO, SEED_COUNT, SEED_RADIUS } from './capacity';
import { CollisionSettings, DEFAULT_COLLISION_SETTINGS } from './collision';
import { Palette, randomPalette, shade } from './palette';
import {
  packParams,
  PARAMS_BYTES,
  Particle,
  PARTICLE_BYTES,
  PARTICLE_WORKGROUP_SIZE,
  SeedParticle
} from './particle-layout';
import { BinGridContents, EraseRegion, SimulationPipeline, StageTimer } from './simulation-pipeline';

export type { BinGridContents, EraseRegion, StageTimer } from './simulation-pipeline';

export { DEFAULT_CAPACITY, MAX_RADIUS_RATIO, SEED_COUNT, SEED_RADIUS } from './capacity';

export interface ScatterOptions {
  count: number;
  /** Particles are scattered over a square of this side, centred on the origin. */
  bounds: number;
  radius: number;
  /** Source of numbers in [0, 1). Defaults to Math.random. */
  random?: () => number;
  /** The palette the particles are shades of. Defaults to a random one. */
  palette?: Palette;
}

/**
 * The default starting state: a uniform scatter, each particle with a small
 * random velocity and a shade of one palette.
 */
export function scatter(options: ScatterOptions): SeedParticle[] {
  const { count, bounds, radius } = options;
  // Starting speeds of up to this each way.
  const maxSpeedUnitsPerSecond = 360;
  const random = options.random ?? Math.random;
  const palette = options.palette ?? randomPalette(random);

  const particles: SeedParticle[] = [];
  for (let i = 0; i < count; i++) {
    const x = random() * bounds - bounds / 2;
    const y = random() * bounds - bounds / 2;
    const vx = (0.5 - random()) * 2 * maxSpeedUnitsPerSecond;
    const vy = (0.5 - random()) * 2 * maxSpeedUnitsPerSecond;
    const rgb = shade(palette, random);
    particles.push({ x, y, vx, vy, radius, rgb });
  }
  return particles;
}

/**
 * The smallest and largest radius among the enabled seeded particles. Rejects
 * a seed the simulation cannot size its buffers and bins from, or whose radii
 * are more than MAX_RADIUS_RATIO times apart, naming what is wrong with it.
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
  if (largest > MAX_RADIUS_RATIO * smallest) {
    throw new Error(
      `seed returned radii from ${smallest} to ${largest}, more than ${MAX_RADIUS_RATIO} times apart`
    );
  }
  return { smallest, largest };
}

/** The device limits that bound the capacity. */
export type CapacityLimits = Pick<
  GPUSupportedLimits,
  'maxStorageBufferBindingSize' | 'maxBufferSize' | 'maxComputeWorkgroupsPerDimension'
>;

/**
 * The most particles a device with these limits can hold. Each per-particle
 * buffer, the particle buffers the largest, is bound whole as storage, and a
 * dispatch over the particles must fit in one dimension of workgroups.
 */
export function maxCapacity(limits: CapacityLimits): number {
  const bufferBytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  return Math.min(
    Math.floor(bufferBytes / PARTICLE_BYTES),
    limits.maxComputeWorkgroupsPerDimension * PARTICLE_WORKGROUP_SIZE
  );
}

/** Gives each particle its index as its particle id. */
function withIds(particles: SeedParticle[]): Particle[] {
  return particles.map((p, id) => ({ ...p, id }));
}

/** Everything outside the simulation that affects one frame of it. */
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

/** An erase whose particles the CPU does not yet know are gone. */
interface PendingErase {
  /** How many it marked, once read back. */
  erased?: number;
  /** Whether a bin grid build has been encoded since, which removes them. */
  built: boolean;
}

export interface VerletOptions {
  /**
   * Side of the square region of simulation space that particles may occupy,
   * centred on the origin: `simulationSize` of the boundary circle's radius.
   */
  bounds: number;
  /** Format of the canvas draw() draws to. */
  format: GPUTextureFormat;
  /**
   * The smallest bin size. The bin buffers are allocated once, for bins this
   * size; bins are one diameter of the largest particle in use wide, but never
   * smaller. Defaults to the diameter of the largest particle of the first
   * seeding.
   */
  minBinSize?: number;
  /**
   * The most particles the simulation holds at once, seeded and spawned. Its
   * buffers are allocated for this many, once; to change it, make a new
   * simulation. Defaults to DEFAULT_CAPACITY.
   */
  capacity?: number;
  /**
   * Produces the starting particles, and is called again by reset(). It must
   * return no more particles than the capacity. Defaults to a random scatter
   * of 15,000 particles of radius SEED_RADIUS, or the capacity if smaller. Each
   * particle's id is its index in what the seed returns.
   */
  seed?: () => SeedParticle[];
}

/**
 * The particle simulation: owns the particles on the GPU, advances them and
 * draws them.
 */
export class Verlet {
  /** The most particles the simulation holds at once. */
  readonly capacity: number;

  private device: GPUDevice;
  private bounds: number;
  private seed: () => SeedParticle[];
  /** The smallest and largest radius seeded or spawned since the last seeding. */
  private radii: { smallest: number; largest: number };
  /**
   * At least as many as the live particles: the particles seeded and spawned,
   * less those erased once their count has been read back and a bin grid
   * build has removed them. The GPU keeps the exact count.
   */
  private liveCount: number;
  /** Erases whose particles still count in liveCount. */
  private pendingErases: PendingErase[] = [];
  /** The particle id the next spawned particle takes. */
  private nextId: number;
  private totalTime = 0;
  private destroyed = false;

  private paramsBuffer: GPUBuffer;
  private pipeline: SimulationPipeline;

  constructor(device: GPUDevice, options: VerletOptions) {
    this.device = device;
    this.bounds = options.bounds;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.seed =
      options.seed ??
      (() =>
        scatter({ count: Math.min(SEED_COUNT, this.capacity), bounds: this.bounds, radius: SEED_RADIUS }));

    if (!(this.bounds > 0) || !Number.isFinite(this.bounds)) {
      throw new Error(`bounds must be a positive number; got ${this.bounds}`);
    }
    if (!Number.isInteger(this.capacity) || this.capacity < 1) {
      throw new Error(`capacity must be a whole number, 1 or more; got ${this.capacity}`);
    }
    const most = maxCapacity(device.limits);
    if (this.capacity > most) {
      throw new Error(`capacity ${this.capacity} is more than this device can hold; at most ${most}`);
    }

    const particles = this.seededParticles();
    this.liveCount = particles.length;
    this.nextId = particles.length;
    const radii = radiusRange(particles);
    this.radii = radii;

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

    try {
      this.pipeline = new SimulationPipeline(device, {
        particles: withIds(particles),
        capacity: this.capacity,
        bounds: this.bounds,
        // A bin must be at least as wide as the largest particle.
        minBinSize: options.minBinSize ?? 2 * radii.largest,
        paramsBuffer: this.paramsBuffer,
        format: options.format
      });
    } catch (error) {
      // Nothing outside holds a reference yet, so release what was created.
      this.paramsBuffer.destroy();
      throw error;
    }
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
    checkSubstepRate(substepRate);
    if (substeps === 0) return;

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
    // Every substep builds the bin grid, which removes erased particles.
    this.pendingErases.forEach((pending) => (pending.built = true));
    this.settleErases();
  }

  /**
   * Encodes a render pass that clears `view`, a canvas of the configured
   * format, and draws the particles into it as `camera` shows them. Draw at
   * most once per submitted encoder.
   */
  draw(encoder: GPUCommandEncoder, view: GPUTextureView, camera: Camera) {
    this.pipeline.draw(encoder, view, cameraProjection(camera));
  }

  /**
   * The number of live particles, or a few more just after an erase: erased
   * particles are counted out once a bin grid build has removed them and
   * their count has been read back, which nothing waits for.
   */
  get particleCount(): number {
    return this.liveCount;
  }

  /** The furthest a particle may move in one substep: the smallest radius in use. */
  private get speedLimit(): number {
    return this.radii.smallest;
  }

  /**
   * Puts the particles back to a fresh starting state from the seed, removing
   * every spawned particle. Particle ids start again from 0.
   */
  reset() {
    const particles = this.seededParticles();
    const radii = radiusRange(particles);
    this.pipeline.write(withIds(particles));
    this.radii = radii;
    this.liveCount = particles.length;
    this.pendingErases = [];
    this.nextId = particles.length;
  }

  /**
   * Adds particles while the simulation runs, each with a particle id not used
   * before, until the simulation holds its capacity; the rest are dropped.
   * Returns how many were added. The bins grow with the largest radius
   * spawned. Erased particles make room once particleCount no longer counts
   * them.
   *
   * Every radius must be more than 0, and keep the largest radius in use at
   * most MAX_RADIUS_RATIO times the smallest.
   *
   * It takes effect at once, so call it between submitted encoders, never
   * between step() and submitting its encoder.
   */
  spawn(particles: SeedParticle[]): number {
    const added = particles.slice(0, this.capacity - this.liveCount);
    let { smallest, largest } = this.radii;
    for (const p of added) {
      if (!(p.radius > 0) || !Number.isFinite(p.radius)) {
        throw new Error(`cannot spawn a particle with radius ${p.radius}; a radius must be more than 0`);
      }
      smallest = Math.min(smallest, p.radius);
      largest = Math.max(largest, p.radius);
      if (largest > MAX_RADIUS_RATIO * smallest) {
        throw new Error(
          `cannot spawn a particle with radius ${p.radius}: the radii in use would run from ` +
            `${smallest} to ${largest}, more than ${MAX_RADIUS_RATIO} times apart`
        );
      }
    }
    if (added.length === 0) return 0;

    const firstId = this.nextId;
    this.pipeline.append(added.map((p, i) => ({ ...p, id: firstId + i })));
    this.liveCount += added.length;
    this.nextId += added.length;
    this.radii = { smallest, largest };
    return added.length;
  }

  /**
   * Erases the particles in the region, those whose centres are within its
   * radius of its centre, while the simulation runs. They are marked on the
   * GPU, and the next bin grid build leaves them out.
   *
   * It takes effect at once, so call it between submitted encoders, never
   * between step() and submitting its encoder. Nothing waits for it: it
   * resolves with how many particles it erased once that has been read back,
   * or with 0 if the simulation is destroyed first.
   */
  erase(region: EraseRegion): Promise<number> {
    const { center, radius } = region;
    if (!center.every(Number.isFinite)) {
      throw new Error(`cannot erase around [${center}]; the centre must be finite`);
    }
    if (!(radius >= 0) || !Number.isFinite(radius)) {
      throw new Error(`cannot erase with radius ${radius}; it must be 0 or more`);
    }
    const pending: PendingErase = { built: false };
    this.pendingErases.push(pending);
    return this.pipeline.erase(region).then(
      (count) => {
        pending.erased = count;
        this.settleErases();
        return count;
      },
      (error) => {
        // Destroying the simulation abandons the readback; nothing is left to count.
        if (this.destroyed) return 0;
        throw error;
      }
    );
  }

  /** Counts out the particles of erases that are both read back and built. */
  private settleErases() {
    this.pendingErases = this.pendingErases.filter((pending) => {
      if (pending.erased === undefined || !pending.built) return true;
      this.liveCount -= pending.erased;
      return false;
    });
  }

  /** Calls the seed, and rejects more particles than the capacity. */
  private seededParticles(): SeedParticle[] {
    const particles = this.seed();
    if (particles.length > this.capacity) {
      throw new Error(
        `seed returned ${particles.length} particles; the capacity is ${this.capacity}`
      );
    }
    return particles;
  }

  /** Reads the current particles back from the GPU, ordered by particle id. */
  readParticles(): Promise<Particle[]> {
    return this.pipeline.read();
  }

  /** Encodes only a bin grid build. Exposed for tests of the build on its own. */
  encodeBinGridBuild(encoder: GPUCommandEncoder) {
    this.pipeline.encodeBinGridBuild(encoder);
  }

  /** What the latest bin grid build left behind. Exposed for tests of the build on its own. */
  readBinGrid(): Promise<BinGridContents> {
    return this.pipeline.readBinGrid();
  }

  /** Releases the GPU resources. The simulation cannot be used afterwards. */
  destroy() {
    this.destroyed = true;
    this.paramsBuffer.destroy();
    this.pipeline.destroy();
  }
}
