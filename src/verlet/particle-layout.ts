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

export interface Particle {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** 0 disables the particle: it neither collides nor draws. */
  radius: number;
  rgb: [number, number, number];
}

/** Lays particles out as the contents of a particle buffer. */
export function packParticles(particles: Particle[]): Float32Array<ArrayBuffer> {
  const data = new Float32Array(particles.length * PARTICLE_WORDS);
  particles.forEach((p, i) => {
    const o = i * PARTICLE_WORDS;
    data[o + POS] = p.x;
    data[o + POS + 1] = p.y;
    data[o + PREV_POS] = p.prevX;
    data[o + PREV_POS + 1] = p.prevY;
    data[o + COLOR_AND_RADIUS] = p.rgb[0];
    data[o + COLOR_AND_RADIUS + 1] = p.rgb[1];
    data[o + COLOR_AND_RADIUS + 2] = p.rgb[2];
    data[o + COLOR_AND_RADIUS + 3] = p.radius;
  });
  return data;
}

/** Reads particles back out of the contents of a particle buffer. */
export function unpackParticles(contents: ArrayBuffer): Particle[] {
  const data = new Float32Array(contents);
  const particles: Particle[] = [];
  for (let o = 0; o + PARTICLE_WORDS <= data.length; o += PARTICLE_WORDS) {
    particles.push({
      x: data[o + POS],
      y: data[o + POS + 1],
      prevX: data[o + PREV_POS],
      prevY: data[o + PREV_POS + 1],
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
  view.set({ ...values, clickPoint: [...values.clickPoint, 0] });
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
