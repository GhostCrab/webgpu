import { expect, test } from 'vitest';

// The layout module parses WGSL with a library that needs WebGPU's constants,
// which ./gpu defines. No GPU is needed for these tests.
import './gpu';

const {
  packParams,
  packParticles,
  PARTICLE_BYTES,
  particleInstanceLayout,
  structShape,
  unpackParticles
} = await import('../src/verlet/particle-layout');

type Rgb = [number, number, number];

test('particles survive a round trip through the particle buffer layout', () => {
  const particles = [
    { x: 1, y: -2, prevX: 3, prevY: -4, radius: 1.5, rgb: [0.25, 0.5, 0.75] as Rgb },
    { x: 100, y: 200, prevX: 100, prevY: 200, radius: 0, rgb: [1, 0, 0] as Rgb }
  ];
  const data = packParticles(particles);
  expect(data.byteLength).toBe(2 * PARTICLE_BYTES);
  expect(unpackParticles(data.buffer)).toEqual(particles);
});

test('the atomic view of a particle has the same layout as the plain one', () => {
  expect(structShape('VerletObjectAtomicBin')).toEqual(structShape('VerletObject'));
});

test('the instance layout strides over whole particles', () => {
  const layout = particleInstanceLayout(2, 3);
  expect(layout.arrayStride).toBe(PARTICLE_BYTES);
  expect(layout.stepMode).toBe('instance');
  expect([...layout.attributes].map((a) => a.shaderLocation)).toEqual([2, 3]);
});

test('params are packed where the shader struct puts them', () => {
  const buffer = packParams({
    totalTime: 1,
    deltaTime: 2,
    constrainRadius: 3,
    boxDim: 4,
    constrainType: 1,
    speedLimit: 8,
    clickPoint: [5, 6, 7]
  });
  const offset = Object.fromEntries(
    structShape('Params').fields.map(([name, fieldOffset]) => [name, fieldOffset / 4])
  );
  const floats = new Float32Array(buffer);
  expect(floats[offset.totalTime]).toBe(1);
  expect(floats[offset.deltaTime]).toBe(2);
  expect(floats[offset.constrainRadius]).toBe(3);
  expect(floats[offset.boxDim]).toBe(4);
  expect(new Uint32Array(buffer)[offset.constrainType]).toBe(1);
  expect(floats[offset.speedLimit]).toBe(8);
  expect([...floats.subarray(offset.clickPoint, offset.clickPoint + 3)]).toEqual([5, 6, 7]);
});
