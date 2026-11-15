import { DEFAULT_SUBSTEP_RATE } from '../clock';
import {
  packParams,
  packParticles,
  PARAMS_BYTES,
  Particle,
  unpackParticles
} from './particle-layout';
import { readBuffer } from '../read-buffer';
import type { DrawTarget } from '../simulation-target';
import { VerletBinComputer } from './verlet-bin-computer';
import { VerletRenderer } from './verlet-renderer';

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
  /** Substeps per second; the starting velocity is expressed per substep. */
  substepRate: number;
  /** Source of numbers in [0, 1). Defaults to Math.random. */
  random?: () => number;
}

/**
 * The default starting state: a uniform scatter, each particle with a small
 * random velocity and a shade of one random hue.
 */
export function scatter(options: ScatterOptions): Particle[] {
  const { count, bounds, radius, substepRate } = options;
  // Starting speeds of up to 360 units per second each way.
  const maxShift = 360 / substepRate;
  const random = options.random ?? Math.random;

  const hue = random();
  let lerpStart = random();
  let lerpEnd = random();
  if (lerpEnd < lerpStart) {
    [lerpStart, lerpEnd] = [lerpEnd, lerpStart];
  }

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const x = random() * bounds - bounds / 2;
    const y = random() * bounds - bounds / 2;
    const prevX = x + (random() - 0.5) * 2 * maxShift;
    const prevY = y + (random() - 0.5) * 2 * maxShift;
    const rgb = HSVtoRGB(hue, lerp(lerpStart, lerpEnd, random()), 1);
    particles.push({ x, y, prevX, prevY, radius, rgb });
  }
  return particles;
}

/**
 * The largest radius among seeded particles. Rejects a seed the simulation
 * cannot size its buffers and bins from, naming what is wrong with it.
 */
function largestRadius(particles: Particle[]): number {
  if (particles.length === 0) {
    throw new Error('seed returned no particles');
  }
  let largest = 0;
  for (const p of particles) {
    if (!Number.isFinite(p.radius) || p.radius < 0) {
      throw new Error(`seed returned a particle with radius ${p.radius}; a radius must be 0 or more`);
    }
    if (p.radius > largest) largest = p.radius;
  }
  if (largest === 0) {
    throw new Error('seed returned only disabled particles (radius 0), so bins cannot be sized');
  }
  return largest;
}

/** Everything outside the simulation that affects one frame of it. */
export interface SimulationInput {
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

export interface VerletOptions {
  /** Side of the square region of simulation space that particles may occupy. */
  bounds: number;
  /** Maps simulation space to clip space; a 4x4 matrix. */
  projection: Float32Array;
  /** The render pass configuration that draw() renders into. */
  target: DrawTarget;
  /**
   * Produces the starting particles, and is called again by reset(). It must
   * return the same number of particles each time. Defaults to a random
   * scatter of 15,000 particles of radius 1.5.
   */
  seed?: () => Particle[];
}

/**
 * The particle simulation: owns the particles on the GPU, advances them and
 * draws them.
 */
export class Verlet {
  readonly particleCount: number;

  /** The compute stage. Exposed for tests of the binning stage only. */
  readonly computer: VerletBinComputer;

  private device: GPUDevice;
  private bounds: number;
  private seed: () => Particle[];
  private binSize: number;
  private totalTime = 0;
  /** The substep rate of the latest step, which the default seed scales to. */
  private substepRate = DEFAULT_SUBSTEP_RATE;

  private particleBuffer: GPUBuffer;
  private paramsBuffer: GPUBuffer;
  private renderer: VerletRenderer;

  constructor(device: GPUDevice, options: VerletOptions) {
    this.device = device;
    this.bounds = options.bounds;
    this.seed =
      options.seed ??
      (() =>
        scatter({ count: 15000, bounds: this.bounds, radius: 1.5, substepRate: this.substepRate }));

    if (!(this.bounds > 0) || !Number.isFinite(this.bounds)) {
      throw new Error(`bounds must be a positive number; got ${this.bounds}`);
    }

    const particles = this.seed();
    this.particleCount = particles.length;
    // A bin must be at least as wide as the largest particle.
    this.binSize = 2 * largestRadius(particles);

    const data = packParticles(particles);
    this.particleBuffer = device.createBuffer({
      size: data.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC
    });
    device.queue.writeBuffer(this.particleBuffer, 0, data);

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
        clickPoint: [0, 0, 0]
      })
    );

    try {
      this.computer = new VerletBinComputer(device, {
        bounds: this.bounds,
        binSize: this.binSize,
        particleCount: this.particleCount,
        particleBuffer: this.particleBuffer,
        paramsBuffer: this.paramsBuffer
      });

      this.renderer = new VerletRenderer(device, {
        projection: options.projection,
        target: options.target
      });
    } catch (error) {
      // Nothing outside holds a reference yet, so release what was created.
      this.particleBuffer.destroy();
      this.paramsBuffer.destroy();
      this.computer?.destroy();
      throw error;
    }
  }

  /**
   * Advances the simulation by `substeps` substeps, each 1 / substepRate
   * seconds long, encoding the work into `encoder`.
   *
   * The input applies to every one of them. It reaches the GPU when the
   * encoder is submitted, so call this at most once per submitted encoder.
   */
  step(encoder: GPUCommandEncoder, substeps: number, input: SimulationInput) {
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
        clickPoint: [input.clickPoint[0], input.clickPoint[1], input.clickForce]
      })
    );

    for (let i = 0; i < substeps; i++) {
      this.computer.encodeSubstep(encoder, input.collide);
    }
  }

  /** Draws the particles into a pass matching the configured draw target. */
  draw(pass: GPURenderPassEncoder) {
    this.renderer.render(pass, this.particleBuffer, this.particleCount);
  }

  /** Puts the particles back to a fresh starting state from the seed. */
  reset() {
    const particles = this.seed();
    if (particles.length !== this.particleCount) {
      throw new Error(
        `seed returned ${particles.length} particles; expected ${this.particleCount}`
      );
    }
    if (2 * largestRadius(particles) > this.binSize) {
      throw new Error('seed returned a particle larger than the bins were sized for');
    }
    this.device.queue.writeBuffer(this.particleBuffer, 0, packParticles(particles));
  }

  /** Reads the current particles back from the GPU. */
  async readParticles(): Promise<Particle[]> {
    return unpackParticles(await this.readParticleBuffer());
  }

  /** The raw contents of the particle buffer. */
  readParticleBuffer(): Promise<ArrayBuffer> {
    return readBuffer(this.device, this.particleBuffer);
  }

  /** Releases the GPU resources. The simulation cannot be used afterwards. */
  destroy() {
    this.particleBuffer.destroy();
    this.paramsBuffer.destroy();
    this.computer.destroy();
    this.renderer.destroy();
  }
}
