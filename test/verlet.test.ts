import { describe, expect, test } from 'vitest';

import { getDevice } from './gpu';
import { BOUNDS, createSim, mulberry32, RADIUS, seededScatter } from './sim-harness';

const { maxCapacity, scatter } = await import('../src/verlet/verlet');

const device = await getDevice();

describe('scatter', () => {
  const options = { count: 500, bounds: BOUNDS, radius: RADIUS };

  test('is reproducible for a given random source', () => {
    const a = scatter({ ...options, random: mulberry32(7) });
    const b = scatter({ ...options, random: mulberry32(7) });
    expect(a).toEqual(b);
    expect(scatter({ ...options, random: mulberry32(8) })).not.toEqual(a);
  });

  test('places every particle inside the bounds with the given radius', () => {
    const particles = scatter({ ...options, random: mulberry32(7) });
    expect(particles).toHaveLength(500);
    for (const p of particles) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(BOUNDS / 2);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(BOUNDS / 2);
      expect(p.radius).toBe(RADIUS);
    }
  });
});

describe('the most particles a device can hold', () => {
  // WebGPU's default limits.
  const defaults = {
    maxStorageBufferBindingSize: 134217728,
    maxBufferSize: 268435456,
    maxComputeWorkgroupsPerDimension: 65535
  };

  test('under the default limits, is as many as one dispatch of 64-wide workgroups covers', () => {
    expect(maxCapacity(defaults)).toBe(65535 * 64);
  });

  test('is as many 24-byte particles as a storage binding holds, when that is fewer', () => {
    expect(maxCapacity({ ...defaults, maxStorageBufferBindingSize: 24_000_000 })).toBe(1_000_000);
  });

  test('is as many 24-byte particles as a buffer holds, when that is fewer', () => {
    expect(maxCapacity({ ...defaults, maxBufferSize: 2_400_000 })).toBe(100_000);
  });
});

describe.skipIf(!device)('capacity', () => {
  test('rejects a capacity the device cannot hold, naming the capacity', async () => {
    const most = maxCapacity(device.limits);
    await expect(createSim([{ x: 0, y: 0 }], { capacity: most + 1 })).rejects.toThrow(
      `capacity ${most + 1} is more than this device can hold; at most ${most}`
    );
  });
});

describe.skipIf(!device)('seeding', () => {
  test('rejects a seed with no particles', async () => {
    await expect(createSim([])).rejects.toThrow('seed returned no particles');
  });

  test('rejects a seed of only disabled particles, which gives bins no size', async () => {
    await expect(createSim([{ x: 0, y: 0, radius: 0 }])).rejects.toThrow('only disabled particles');
  });

  test.each([NaN, -1, Infinity])('rejects a particle with radius %s', async (radius) => {
    await expect(createSim([{ x: 0, y: 0 }, { x: 5, y: 5, radius }])).rejects.toThrow(
      `particle with radius ${radius}`
    );
  });

  test('accepts radii up to 4 times apart, and rejects radii further apart', async () => {
    await expect(createSim([{ x: 0, y: 0, radius: 1.5 }, { x: 10, y: 0, radius: 6 }])).resolves.not.toBeNull();
    await expect(createSim([{ x: 0, y: 0, radius: 1.5 }, { x: 10, y: 0, radius: 6.1 }])).rejects.toThrow(
      'seed returned radii from 1.5 to 6.1, more than 4 times apart'
    );
  });

  test('a disabled particle does not count toward the radius ratio', async () => {
    await expect(
      createSim([{ x: 0, y: 0, radius: 0 }, { x: 10, y: 0, radius: 6 }, { x: 20, y: 0, radius: 2 }])
    ).resolves.not.toBeNull();
  });

  test('accepts far more particles than the default', async () => {
    const sim = await createSim(seededScatter(200000, 5));
    sim.step(20);
    expect(await sim.read()).toHaveLength(200000);
  });
});

describe.skipIf(!device)('reset', () => {
  test('returns the particles to their seeded start', async () => {
    const start = [
      { x: 10, y: 20 },
      { x: -30, y: 40 }
    ];
    const sim = await createSim(start);
    sim.step(200);
    const moved = await sim.read();
    expect(moved[0].y).toBeGreaterThan(20);

    sim.reset();
    const after = await sim.read();
    expect(after.map((p) => [p.x, p.y, p.vx, p.vy])).toEqual([
      [10, 20, 0, 0],
      [-30, 40, 0, 0]
    ]);
  });
});
