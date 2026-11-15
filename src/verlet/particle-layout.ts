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

const particleStruct = structs.VerletObject;
const offsetOf = (field: string) => particleStruct.fields[field].offset;

const POS = offsetOf('pos') / 4;
const PREV_POS = offsetOf('prevPos') / 4;
const COLOR_AND_RADIUS = offsetOf('colorAndRadius') / 4;
const BIN_LINK = offsetOf('binLink') / 4;

/** Bytes one particle occupies in the particle buffer. */
export const PARTICLE_BYTES = particleStruct.size;
const PARTICLE_WORDS = PARTICLE_BYTES / 4;

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

/**
 * Lays particles out as the contents of the current pipeline's particle
 * buffer. That pipeline holds velocity as the previous position: one substep
 * at `substepRate` behind the position. A particle's id is its index.
 */
export function packParticles(particles: SeedParticle[], substepRate: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(particles.length * PARTICLE_WORDS);
  particles.forEach((p, i) => {
    const o = i * PARTICLE_WORDS;
    data[o + POS] = p.x;
    data[o + POS + 1] = p.y;
    data[o + PREV_POS] = p.x - p.vx / substepRate;
    data[o + PREV_POS + 1] = p.y - p.vy / substepRate;
    data[o + COLOR_AND_RADIUS] = p.rgb[0];
    data[o + COLOR_AND_RADIUS + 1] = p.rgb[1];
    data[o + COLOR_AND_RADIUS + 2] = p.rgb[2];
    data[o + COLOR_AND_RADIUS + 3] = p.radius;
  });
  return data;
}

/**
 * Reads particles back out of the contents of the current pipeline's particle
 * buffer, deriving velocity from the move over one substep at `substepRate`.
 */
export function unpackParticles(contents: ArrayBuffer, substepRate: number): Particle[] {
  const data = new Float32Array(contents);
  const particles: Particle[] = [];
  for (let o = 0; o + PARTICLE_WORDS <= data.length; o += PARTICLE_WORDS) {
    const x = data[o + POS];
    const y = data[o + POS + 1];
    particles.push({
      id: particles.length,
      x,
      y,
      vx: (x - data[o + PREV_POS]) * substepRate,
      vy: (y - data[o + PREV_POS + 1]) * substepRate,
      radius: data[o + COLOR_AND_RADIUS + 3],
      rgb: [
        data[o + COLOR_AND_RADIUS],
        data[o + COLOR_AND_RADIUS + 1],
        data[o + COLOR_AND_RADIUS + 2]
      ]
    });
  }
  return particles;
}

/** Each particle's link to the next particle in its bin list (-1 ends a list). */
export function unpackBinLinks(contents: ArrayBuffer): Int32Array {
  const data = new Int32Array(contents);
  const links = new Int32Array(data.length / PARTICLE_WORDS);
  for (let i = 0; i < links.length; i++) {
    links[i] = data[i * PARTICLE_WORDS + BIN_LINK];
  }
  return links;
}

/**
 * The particle buffer as a per-instance vertex buffer, exposing the position
 * and the colour-and-radius fields at the given shader locations.
 */
export function particleInstanceLayout(
  positionLocation: number,
  colorAndRadiusLocation: number
): GPUVertexBufferLayout {
  return {
    arrayStride: PARTICLE_BYTES,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: positionLocation, offset: offsetOf('pos'), format: 'float32x4' },
      {
        shaderLocation: colorAndRadiusLocation,
        offset: offsetOf('colorAndRadius'),
        format: 'float32x4'
      }
    ]
  };
}

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
