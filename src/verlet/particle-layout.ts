import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';

import commonWGSL from './shaders/common.wgsl';

/**
 * The particle layout: how one particle's fields are arranged in memory.
 *
 * The WGSL structs in shaders/common.wgsl are the single description. Every
 * offset and size used on the CPU side is read from them here, so nothing
 * outside this file knows where a field lives.
 */

const { structs } = makeShaderDataDefinitions(commonWGSL);

/** One particle, as the simulation interface takes and returns it. */
export interface Particle {
  /** Identifies the particle for its whole life, wherever it sits in memory. */
  id: number;
  x: number;
  y: number;
  /** Velocity, in simulation units per second. */
  vx: number;
  vy: number;
  /** 0 disables the particle: it neither collides nor draws. */
  radius: number;
  rgb: [number, number, number];
}

/** A particle before the simulation has given it a particle id. */
export type SeedParticle = Omit<Particle, 'id'>;

/** Bytes of the simulation params uniform. */
export const PARAMS_BYTES = structs.Params.size;

export interface ParamsValues {
  totalTime: number;
  /** Time covered by one substep, in seconds. */
  deltaTime: number;
  constrainRadius: number;
  /** Centre of the boundary circle. */
  constrainCenter: [number, number];
  boxDim: number;
  /** 0: classic constrain, 1: reflective constrain. */
  constrainType: number;
  /** The furthest a particle may move in one substep. */
  speedLimit: number;
  /** x, y, and the click force in z. */
  clickPoint: [number, number, number];
  /** The collision settings. */
  relaxation: number;
  particleRestitution: number;
  particleDamping: number;
}

/** Lays out the contents of the simulation params uniform. */
export function packParams(values: ParamsValues): ArrayBuffer {
  const view = makeStructuredView(structs.Params);
  view.set({
    ...values,
    constrainCenter: [...values.constrainCenter, 0, 0],
    clickPoint: [...values.clickPoint, 0]
  });
  return view.arrayBuffer;
}

/** Field names, offsets and sizes of a struct in common.wgsl, for layout checks. */
export function structShape(name: string): { size: number; fields: [string, number, number][] } {
  const struct = structs[name];
  return {
    size: struct.size,
    fields: Object.entries(struct.fields).map(([field, { offset, type }]) => [
      field,
      offset,
      (type as { size: number }).size
    ])
  };
}

// The particle (the Particle struct in common.wgsl).
const particleStruct = structs.Particle;
const offsetOf = (field: string) => particleStruct.fields[field].offset / 4;
const POS = offsetOf('pos');
const VEL = offsetOf('vel');
const RADIUS = offsetOf('radius');
const ID = offsetOf('id');

/** Bytes one particle occupies in the particle buffer. */
export const PARTICLE_BYTES = particleStruct.size;
const PARTICLE_WORDS = PARTICLE_BYTES / 4;

/** Bytes of one particle's colour in the colour buffer: 8 bits a channel. */
export const COLOR_BYTES = 4;

const toByte = (channel: number) => Math.round(Math.min(Math.max(channel, 0), 1) * 255);

/**
 * Lays particles out as the contents of the particle buffer,
 * in the order given, and their colours as the contents of its colour buffer,
 * where a particle's colour sits at its particle id. Ids must run from 0 to
 * one less than the number of particles.
 */
export function packParticles(particles: Particle[]): {
  particleData: Float32Array<ArrayBuffer>;
  colorData: Uint32Array<ArrayBuffer>;
} {
  const particleData = new Float32Array(particles.length * PARTICLE_WORDS);
  const ids = new Uint32Array(particleData.buffer);
  const colorData = new Uint32Array(particles.length);
  particles.forEach((p, i) => {
    const o = i * PARTICLE_WORDS;
    particleData[o + POS] = p.x;
    particleData[o + POS + 1] = p.y;
    particleData[o + VEL] = p.vx;
    particleData[o + VEL + 1] = p.vy;
    particleData[o + RADIUS] = p.radius;
    ids[o + ID] = p.id;
    // Red in the low byte, as the shader's unpack4x8unorm reads it.
    const [r, g, b] = p.rgb;
    colorData[p.id] = (toByte(r) | (toByte(g) << 8) | (toByte(b) << 16) | (255 << 24)) >>> 0;
  });
  return { particleData, colorData };
}

/**
 * Reads particles back out of the contents of the particle and colour
 * buffers, ordered by particle id.
 */
export function unpackParticles(
  particleContents: ArrayBuffer,
  colorContents: ArrayBuffer
): Particle[] {
  return unpackParticlesInPlace(particleContents, colorContents).sort((a, b) => a.id - b.id);
}

/**
 * Reads particles back out of the contents of the particle and colour
 * buffers, in the order they sit in the particle buffer.
 */
export function unpackParticlesInPlace(
  particleContents: ArrayBuffer,
  colorContents: ArrayBuffer
): Particle[] {
  const data = new Float32Array(particleContents);
  const ids = new Uint32Array(particleContents);
  const colors = new Uint32Array(colorContents);
  const particles: Particle[] = [];
  for (let o = 0; o + PARTICLE_WORDS <= data.length; o += PARTICLE_WORDS) {
    const id = ids[o + ID];
    const color = colors[id];
    particles.push({
      id,
      x: data[o + POS],
      y: data[o + POS + 1],
      vx: data[o + VEL],
      vy: data[o + VEL + 1],
      radius: data[o + RADIUS],
      rgb: [(color & 0xff) / 255, ((color >>> 8) & 0xff) / 255, ((color >>> 16) & 0xff) / 255]
    });
  }
  return particles;
}

/** Bytes of the bin grid uniform (BinGridParams in common.wgsl). */
export const BIN_GRID_PARAMS_BYTES = structs.BinGridParams.size;

/** Lays out the contents of the bin grid uniform. */
export function packBinGridParams(values: {
  binSize: number;
  width: number;
  height: number;
  binCount: number;
}): ArrayBuffer {
  const view = makeStructuredView(structs.BinGridParams);
  view.set(values);
  return view.arrayBuffer;
}

/**
 * The particle buffer as a per-instance vertex buffer, exposing
 * the position, the radius and the particle id at the given shader locations.
 */
export function particleInstanceLayout(
  positionLocation: number,
  radiusLocation: number,
  idLocation: number
): GPUVertexBufferLayout {
  return {
    arrayStride: PARTICLE_BYTES,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: positionLocation, offset: POS * 4, format: 'float32x2' },
      { shaderLocation: radiusLocation, offset: RADIUS * 4, format: 'float32' },
      { shaderLocation: idLocation, offset: ID * 4, format: 'uint32' }
    ]
  };
}
