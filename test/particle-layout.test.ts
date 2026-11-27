import { describe, expect, test } from 'vitest';

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

const { TOOL_EFFECT_KIND } = await import('../src/verlet/tool-effect');
type ToolEffect = import('../src/verlet/tool-effect').ToolEffect;

type Rgb = [number, number, number];

test('params are packed where the shader struct puts them', () => {
  const buffer = packParams({
    totalTime: 1,
    deltaTime: 2,
    constrainRadius: 3,
    constrainCenter: [8, 9],
    constrainVelocity: [10, 11],
    gravity: [12, 13],
    toolEffect: { kind: 'stir', center: [14, 15], radius: 16, velocity: [17, 18], rate: 19 },
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
  expect([...floats.subarray(offset.constrainCenter + 2, offset.constrainCenter + 4)]).toEqual([10, 11]);
  expect([...floats.subarray(offset.gravity, offset.gravity + 2)]).toEqual([12, 13]);
  expect(new Uint32Array(buffer)[offset.toolKind]).toBe(TOOL_EFFECT_KIND.stir);
  expect([...floats.subarray(offset.toolArea, offset.toolArea + 4)]).toEqual([14, 15, 16, 19]);
  expect([...floats.subarray(offset.toolMotion, offset.toolMotion + 2)]).toEqual([17, 18]);
});

test.each([
  [{ kind: 'vortex', center: [1, 2], radius: 3, strength: -4 }, [1, 2, 3, -4], [0, 0, 0]],
  [{ kind: 'shockwave', center: [1, 2], ringRadius: 5, width: 3, strength: 4 }, [1, 2, 3, 4], [0, 0, 5]],
  [{ kind: 'obstacle', center: [1, 2], radius: 3, velocity: [6, 7] }, [1, 2, 3, 0], [6, 7, 0]]
] as const)('a %o tool effect is packed where the shaders read it', (toolEffect, area, motion) => {
  const buffer = packParams({
    totalTime: 0,
    deltaTime: 0,
    constrainRadius: 0,
    constrainCenter: [0, 0],
    constrainVelocity: [0, 0],
    gravity: [0, 0],
    toolEffect: toolEffect as ToolEffect,
    boxDim: 0,
    constrainType: 0,
    speedLimit: 0,
    clickPoint: [0, 0, 0],
    relaxation: 0,
    particleRestitution: 0,
    particleDamping: 0
  });
  const offset = Object.fromEntries(
    structShape('Params').fields.map(([name, fieldOffset]) => [name, fieldOffset / 4])
  );
  const floats = new Float32Array(buffer);
  expect(new Uint32Array(buffer)[offset.toolKind]).toBe(TOOL_EFFECT_KIND[toolEffect.kind]);
  expect([...floats.subarray(offset.toolArea, offset.toolArea + 4)]).toEqual(area);
  expect([...floats.subarray(offset.toolMotion, offset.toolMotion + 3)]).toEqual(motion);
});

describe('the particle', () => {
  const particles = [
    { id: 0, x: 1, y: -2, vx: -2400, vy: 2400, radius: 1.5, rgb: [0, 0.2, 1] as Rgb },
    { id: 1, x: 100, y: 200, vx: 0.5, vy: -7, radius: 6, rgb: [1, 0, 0.6] as Rgb },
    { id: 2, x: -50, y: 0, vx: 0, vy: 0, radius: 0, rgb: [1, 1, 1] as Rgb }
  ];

  test('takes about 32 bytes', () => {
    expect(PARTICLE_BYTES).toBeLessThanOrEqual(32);
  });

  test('survives a round trip through the particle and colour buffers', () => {
    const { particleData, colorData } = packParticles(particles);
    expect(particleData.byteLength).toBe(3 * PARTICLE_BYTES);
    expect(unpackParticles(particleData.buffer, colorData.buffer)).toEqual(particles);
  });

  test('reads back ordered by particle id, each with its own colour, wherever it sits in memory', () => {
    const shuffled = [particles[2], particles[0], particles[1]];
    const { particleData, colorData } = packParticles(shuffled);
    expect(unpackParticles(particleData.buffer, colorData.buffer)).toEqual(particles);
  });

  test('stores colour at 8 bits a channel', () => {
    const { particleData, colorData } = packParticles([
      { ...particles[0], rgb: [0.5, 0.25, 0.75] }
    ]);
    const [p] = unpackParticles(particleData.buffer, colorData.buffer);
    expect(p.rgb).toEqual([128 / 255, 64 / 255, 191 / 255]);
  });

  test('the instance layout strides over whole particles', () => {
    const layout = particleInstanceLayout(2, 3);
    expect(layout.arrayStride).toBe(PARTICLE_BYTES);
    expect(layout.stepMode).toBe('instance');
    expect([...layout.attributes].map((a) => a.shaderLocation)).toEqual([2, 3]);
  });
});
