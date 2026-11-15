import { describe, expect, test } from 'vitest';

import { getDevice } from './gpu';
import { BOUNDS, createSim, runStats, seededScatter } from './sim-harness';

const { sizeBinGrid } = await import('../src/verlet/bin-grid');

// These tests run the real WGSL pipelines on a real GPU. Without one they skip.
const device = await getDevice();

describe.skipIf(!device)('spawning', () => {
  test('raises the live count by the number spawned, each with a particle id not used before', async () => {
    const sim = await createSim([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    expect(sim.spawn([{ x: 100, y: 50 }, { x: -100, y: 50, rgb: [1, 0, 0] }])).toBe(2);
    expect(sim.count).toBe(5);

    const particles = await sim.read();
    expect(particles.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
    expect(particles.slice(3).map((p) => [p.x, p.y, p.rgb])).toEqual([
      [100, 50, [1, 1, 1]],
      [-100, 50, [1, 0, 0]]
    ]);

    sim.spawn([{ x: 0, y: 100 }]);
    expect((await sim.read()).map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('spawned particles fall like seeded ones', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(20);
    sim.spawn([{ x: 100, y: 0 }]);
    const [seeded] = await sim.read();
    sim.step(20);
    const [, spawned] = await sim.read();
    // Each fell the same distance over its first 20 substeps.
    expect(spawned.x).toBe(100);
    expect(spawned.y).toBeCloseTo(seeded.y, 5);
    expect(spawned.vy).toBeCloseTo(seeded.vy, 3);
  });

  test('spawned particles collide with seeded ones and with each other', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    // Each overlaps the one before it by half a radius.
    sim.spawn([{ x: 2.25, y: 0 }, { x: 4.5, y: 0 }]);
    sim.step(20);
    const stats = runStats(await sim.read());
    expect(stats.nonFinite).toBe(0);
    expect(stats.maxOverlap).toBeLessThan(0.05);
  });

  test('spawned particles are drawn in their colour at their position', async () => {
    // A 256x144 image of the 3840x2160 space: 15 simulation units per pixel.
    const sim = await createSim([{ x: 0, y: 0, radius: 150, rgb: [0, 1, 0] }]);
    sim.spawn([{ x: -600, y: -150, radius: 150, rgb: [1, 0, 0] }]);
    const pixel = await sim.render(256, 144);
    expect(pixel(128, 72)).toEqual([0, 255, 0]);
    expect(pixel(88, 62)).toEqual([255, 0, 0]);
  });

  test('existing particles keep their identity, place and colour', async () => {
    const sim = await createSim(seededScatter(500, 3));
    sim.step(20);
    const before = await sim.read();
    sim.spawn(seededScatter(100, 4));
    const after = await sim.read();
    expect(after).toHaveLength(600);
    expect(after.slice(0, 500)).toEqual(before);
  });

  test('stops at capacity, adding nothing more and raising no GPU error', async () => {
    const sim = await createSim([{ x: 0, y: 0 }], { capacity: 3 });
    expect(sim.spawn([{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }])).toBe(2);
    expect(sim.spawn([{ x: 40, y: 0 }])).toBe(0);
    expect(sim.count).toBe(3);
    sim.step(20);
    expect((await sim.read()).map((p) => p.x)).toEqual([0, 10, 20]);
  });

  test('a particle larger than any present grows the bins, and its collisions are resolved', async () => {
    // Bins start 3 units wide. The spawned particle's centre is three bins from
    // the seeded one's, so only bins sized for it bring the two together.
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.spawn([{ x: 7, y: 0, radius: 6 }]);
    const { grid } = await sim.readBinGrid();
    expect(grid).toEqual(sizeBinGrid({ bounds: BOUNDS, largestRadius: 6, minBinSize: 3 }));

    sim.step(20);
    const [small, large] = await sim.read();
    expect(large.x - small.x).toBeGreaterThan(7.45);
  });

  test.each([0, -1, NaN])('rejects a particle with radius %s', async (radius) => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    expect(() => sim.spawn([{ x: 10, y: 0, radius }])).toThrow(`radius ${radius}`);
    expect(sim.count).toBe(1);
  });

  test('rejects a radius more than four times the smallest in use', async () => {
    const sim = await createSim([{ x: 0, y: 0, radius: 1.5 }]);
    expect(sim.spawn([{ x: 10, y: 0, radius: 6 }])).toBe(1);
    expect(() => sim.spawn([{ x: 30, y: 0, radius: 6.1 }])).toThrow('more than 4 times apart');
    expect(() => sim.spawn([{ x: 30, y: 0, radius: 1.4 }])).toThrow('more than 4 times apart');
    expect(sim.count).toBe(2);
  });

  test('reset removes spawned particles and starts particle ids again', async () => {
    const sim = await createSim([{ x: 0, y: 0 }], { capacity: 2 });
    sim.spawn([{ x: 10, y: 0 }]);
    sim.reset();
    expect(sim.count).toBe(1);
    expect(sim.spawn([{ x: 20, y: 0 }])).toBe(1);
    expect((await sim.read()).map((p) => [p.id, p.x])).toEqual([
      [0, 0],
      [1, 20]
    ]);
  });
});
