import { describe, expect, test } from 'vitest';

// The layout module parses WGSL with a library that needs WebGPU's constants,
// which ./gpu defines. No GPU is needed for these tests.
import './gpu';

const {
  COMPACT_PARTICLE_BYTES,
  packCompactParticles,
  packParams,
  packParticles,
  PARTICLE_BYTES,
  particleInstanceLayout,
  structShape,
  unpackCompactParticles,
  unpackParticles
} = await import('../src/verlet/particle-layout');

type Rgb = [number, number, number];

test('particles survive a round trip through the particle buffer layout', () => {
  const particles = [
    { id: 0, x: 1, y: -2, vx: -2400, vy: 2400, radius: 1.5, rgb: [0.25, 0.5, 0.75] as Rgb },
    { id: 1, x: 100, y: 200, vx: 0, vy: 0, radius: 0, rgb: [1, 0, 0] as Rgb }
  ];
  // The current pipeline holds velocity as the move over one substep.
  const data = packParticles(particles, 1200);
  expect(data.byteLength).toBe(2 * PARTICLE_BYTES);
  expect(unpackParticles(data.buffer, 1200)).toEqual(particles);
});

test('the current pipeline holds velocity as a move per substep behind the position', () => {
  const [particle] = unpackParticles(
    packParticles([{ x: 10, y: 20, vx: 600, vy: -1200, radius: 1, rgb: [1, 1, 1] }], 1200)
      .buffer,
    2400
  );
  // 0.5 and -1 per substep, read back at twice the substep rate.
  expect([particle.vx, particle.vy]).toEqual([1200, -2400]);
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
    constrainCenter: [8, 9],
    boxDim: 4,
    constrainType: 1,
    speedLimit: 8,
    clickPoint: [5, 6, 7],
    relaxation: 1.25,
    particleRestitution: 0.5,
    particleDamping: 0.25
  });
  const offset = Object.fromEntries(
    structShape('Params').fields.map(([name, fieldOffset]) => [name, fieldOffset / 4])
  );
  const floats = new Float32Array(buffer);
  expect(floats[offset.totalTime]).toBe(1);
  expect(floats[offset.deltaTime]).toBe(2);
  expect(floats[offset.constrainRadius]).toBe(3);
  expect([...floats.subarray(offset.constrainCenter, offset.constrainCenter + 2)]).toEqual([8, 9]);
  expect(floats[offset.boxDim]).toBe(4);
  expect(new Uint32Array(buffer)[offset.constrainType]).toBe(1);
  expect(floats[offset.speedLimit]).toBe(8);
  expect([...floats.subarray(offset.clickPoint, offset.clickPoint + 3)]).toEqual([5, 6, 7]);
  expect(floats[offset.relaxation]).toBe(1.25);
  expect(floats[offset.particleRestitution]).toBe(0.5);
  expect(floats[offset.particleDamping]).toBe(0.25);
});

describe('the compact particle of the new pipeline', () => {
  const particles = [
    { id: 0, x: 1, y: -2, vx: -2400, vy: 2400, radius: 1.5, rgb: [0, 0.2, 1] as Rgb },
    { id: 1, x: 100, y: 200, vx: 0.5, vy: -7, radius: 6, rgb: [1, 0, 0.6] as Rgb },
    { id: 2, x: -50, y: 0, vx: 0, vy: 0, radius: 0, rgb: [1, 1, 1] as Rgb }
  ];

  test('takes about 32 bytes', () => {
    expect(COMPACT_PARTICLE_BYTES).toBeLessThanOrEqual(32);
  });

  test('survives a round trip through the particle and colour buffers', () => {
    const { particleData, colorData } = packCompactParticles(particles);
    expect(particleData.byteLength).toBe(3 * COMPACT_PARTICLE_BYTES);
    expect(unpackCompactParticles(particleData.buffer, colorData.buffer)).toEqual(particles);
  });

  test('reads back ordered by particle id, each with its own colour, wherever it sits in memory', () => {
    const shuffled = [particles[2], particles[0], particles[1]];
    const { particleData, colorData } = packCompactParticles(shuffled);
    expect(unpackCompactParticles(particleData.buffer, colorData.buffer)).toEqual(particles);
  });

  test('stores colour at 8 bits a channel', () => {
    const { particleData, colorData } = packCompactParticles([
      { ...particles[0], rgb: [0.5, 0.25, 0.75] }
    ]);
    const [p] = unpackCompactParticles(particleData.buffer, colorData.buffer);
    expect(p.rgb).toEqual([128 / 255, 64 / 255, 191 / 255]);
  });
});
