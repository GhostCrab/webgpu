import { describe, expect, test } from 'vitest';

import { getDevice } from './gpu';
import { createSim, ParticleState, seededScatter } from './sim-harness';

// These tests run the real WGSL pipelines on a real GPU. Without one they skip.
const device = await getDevice();

describe.skipIf(!device)('erasing', () => {
  test('removes exactly the particles whose centres are inside the region', async () => {
    const sim = await createSim([
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 11, y: 0 },
      { x: 0, y: -9.5 },
      { x: 50, y: 50 }
    ]);
    expect(await sim.erase(0, 0, 10)).toBe(3);
    expect((await sim.read()).map((p) => p.id)).toEqual([2, 4]);
  });

  test('leaves the surviving particles their particle ids, positions, velocities and colours', async () => {
    const sim = await createSim(seededScatter(2000, 5));
    sim.step(20);
    const before = await sim.read();
    await sim.erase(0, 0, 300);
    const after = await sim.read();
    // The GPU measures in 32-bit floats, so a particle within a hair of the
    // edge may go either way.
    const distance = (p: ParticleState) => Math.hypot(p.x, p.y);
    const ambiguous = (p: ParticleState) => Math.abs(distance(p) - 300) < 1e-3;
    expect(after.filter((p) => !ambiguous(p))).toEqual(
      before.filter((p) => distance(p) > 300 && !ambiguous(p))
    );
    expect(after.length).toBeLessThan(before.length);
  });

  test('the next bin grid build holds every surviving particle exactly once, and no erased one', async () => {
    const sim = await createSim(seededScatter(2000, 6));
    sim.step(20);
    await sim.erase(-200, 100, 400);
    const survivors = (await sim.read()).map((p) => p.id);

    const { particles, binStarts } = await sim.readBinGrid();
    expect(binStarts[binStarts.length - 1]).toBe(survivors.length);
    expect(particles.map((p) => p.id).sort((a, b) => a - b)).toEqual(survivors);
  });

  test('an erased particle stays erased while the simulation runs on', async () => {
    const sim = await createSim(seededScatter(2000, 7));
    await sim.erase(0, 0, 500);
    const survivors = (await sim.read()).map((p) => p.id);
    sim.step(60);
    expect((await sim.read()).map((p) => p.id)).toEqual(survivors);
  });

  test('an erase still pending when the simulation is destroyed resolves with 0', async () => {
    // As when the app restarts the simulation while the erase key is held.
    const sim = await createSim(seededScatter(2000, 9));
    const erased = sim.erase(0, 0, 300);
    sim.destroy();
    await expect(erased).resolves.toBe(0);
  });
});

describe.skipIf(!device)('spawning after erasing', () => {
  test('appends after the survivors, overwriting none of them', async () => {
    const sim = await createSim([
      { x: 0, y: 0 },
      { x: 100, y: 0, rgb: [1, 0, 0] },
      { x: 200, y: 0 }
    ]);
    await sim.erase(0, 0, 10);
    // Spawned before any bin grid build has removed the erased particle.
    expect(sim.spawn([{ x: 300, y: 0, rgb: [0, 1, 0] }])).toBe(1);
    sim.step(1, { collide: false });
    expect(sim.spawn([{ x: 400, y: 0, rgb: [0, 0, 1] }])).toBe(1);

    const particles = await sim.read();
    expect(particles.map((p) => [p.id, p.x, p.rgb])).toEqual([
      [1, 100, [1, 0, 0]],
      [2, 200, [1, 1, 1]],
      [3, 300, [0, 1, 0]],
      [4, 400, [0, 0, 1]]
    ]);
  });

  test('frees room up to the capacity once the erase is counted, and never exceeds it', async () => {
    const sim = await createSim(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 }
      ],
      { capacity: 3 }
    );
    expect(await sim.erase(0, 0, 150)).toBe(2);
    // The erased particles hold their places until a bin grid build removes them.
    expect(sim.spawn([{ x: 300, y: 0 }])).toBe(0);
    sim.step(1);
    expect(sim.count).toBe(1);
    expect(sim.spawn([{ x: 300, y: 0 }, { x: 400, y: 0 }, { x: 500, y: 0 }])).toBe(2);
    expect(sim.count).toBe(3);
    sim.step(20);
    expect((await sim.read()).map((p) => p.id)).toEqual([2, 3, 4]);
  });

  test('spawned particles are drawn in their own colour after erasing moves the rest', async () => {
    // A 256x144 canvas fits the 2160-unit square of simulation space to its
    // height: 15 simulation units per pixel.
    const sim = await createSim([
      { x: -600, y: 0, radius: 150, rgb: [1, 0, 0] },
      { x: 0, y: 0, radius: 150, rgb: [0, 1, 0] }
    ]);
    await sim.erase(-600, 0, 10);
    sim.step(1, { collide: false });
    sim.spawn([{ x: 600, y: 0, radius: 150, rgb: [0, 0, 1] }]);
    const pixel = await sim.render(256, 144);
    expect(pixel(88, 72)).toEqual([0, 0, 0]);
    expect(pixel(128, 72)).toEqual([0, 255, 0]);
    expect(pixel(168, 72)).toEqual([0, 0, 255]);
  });
});

describe.skipIf(!device)('erasing every particle', () => {
  test('leaves an empty simulation that still advances, spawns and draws', async () => {
    const sim = await createSim(seededScatter(500, 8));
    await sim.erase(0, 0, 2000);
    sim.step(20);
    expect(await sim.read()).toEqual([]);
    expect(sim.count).toBe(0);
    expect((await sim.render(64, 36))(32, 18)).toEqual([0, 0, 0]);

    sim.spawn([{ x: 0, y: 0 }]);
    sim.step(20);
    const [p] = await sim.read();
    expect(p.id).toBe(500);
    expect(p.y).toBeGreaterThan(0);
  });
});
