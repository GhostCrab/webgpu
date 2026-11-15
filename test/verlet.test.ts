import { describe, expect, test } from 'vitest';

import { getDevice } from './gpu';
import { BOUNDS, createSim, mulberry32, RADIUS, seededScatter } from './sim-harness';

const { binGrid } = await import('../src/verlet/verlet-bin-computer');
const { scatter } = await import('../src/verlet/verlet');

const device = await getDevice();

describe('bin grid sizing', () => {
  test('covers the bounds with bins one particle diameter wide', () => {
    expect(binGrid(2160, 3)).toEqual({ binSize: 3, width: 720, height: 720, binCount: 518400 });
  });

  test('rounds the grid up to an even number of bins each way', () => {
    // 100 / 4 = 25 bins, which collision's every-second-bin passes cannot split.
    const grid = binGrid(100, 4);
    expect(grid.width).toBe(26);
    expect(grid.height).toBe(26);
  });

  test('never makes a bin narrower than asked', () => {
    expect(binGrid(100, 2.4).binSize).toBe(3);
  });
});

describe('scatter', () => {
  const options = { count: 500, bounds: BOUNDS, radius: RADIUS, substeps: 20 };

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

describe.skipIf(!device)('seeding', () => {
  test('rejects a seed with no particles', async () => {
    await expect(createSim([])).rejects.toThrow('seed returned no particles');
  });

  test('rejects a seed of only disabled particles, which gives bins no size', async () => {
    await expect(createSim([{ x: 0, y: 0, radius: 0 }])).rejects.toThrow('only disabled particles');
  });

  test('accepts far more particles than the default', async () => {
    const sim = await createSim(seededScatter(200000, 5));
    sim.step(1);
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
    sim.step(10);
    const moved = await sim.read();
    expect(moved[0].y).toBeGreaterThan(20);

    sim.reset();
    const after = await sim.read();
    expect(after.map((p) => [p.x, p.y, p.prevX, p.prevY])).toEqual([
      [10, 20, 10, 20],
      [-30, 40, -30, 40]
    ]);
  });
});
