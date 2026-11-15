import type { DrawTarget } from '../simulation-target';
import type { Particle } from './particle-layout';
import type { StageTimer } from './verlet-bin-computer';

/**
 * One way of advancing and drawing the particles, internal to Verlet. While
 * the new pipeline of spec #9 is built beside the current one, Verlet runs
 * whichever was chosen when it was constructed.
 */
export interface Pipeline {
  /** Replaces every particle. Particle ids run from 0 in the order given. */
  write(particles: Particle[], substepRate: number): void;
  /**
   * Encodes one substep, reading the simulation params uniform. Without a
   * timer it is a single compute pass; with one, each stage gets a pass of its
   * own carrying the timer's timestamp writes.
   */
  encodeSubstep(encoder: GPUCommandEncoder, collide: boolean, timer?: StageTimer): void;
  /** Reads the particles back, ordered by particle id. */
  read(substepRate: number): Promise<Particle[]>;
  /** Draws the particles into a pass matching the configured draw target. */
  draw(pass: GPURenderPassEncoder): void;
  destroy(): void;
}

export interface PipelineOptions {
  /** The starting particles; their ids run from 0 in the order given. */
  particles: Particle[];
  /** The substep rate the starting velocities are first used at. */
  substepRate: number;
  /** Side of the square region of simulation space that particles may occupy. */
  bounds: number;
  /** At least the diameter of the largest particle. */
  binSize: number;
  /** The simulation params uniform (the Params struct in common.wgsl). */
  paramsBuffer: GPUBuffer;
  /** Maps simulation space to clip space; a 4x4 matrix. */
  projection: Float32Array;
  /** The render pass configuration the particles are drawn into. */
  target: DrawTarget;
}
