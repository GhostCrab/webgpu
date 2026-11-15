import { describe, expect, test } from 'vitest';

import { getDevice } from './gpu';

import { SimulationTarget } from '../src/simulation-target';
import {
  createSim,
  DEFAULT_CONSTRAIN_RADIUS,
  RADIUS,
  runStats,
  seededScatter,
  SUBSTEP_RATE
} from './sim-harness';

// These tests run the real WGSL pipelines on a real GPU. Without one they skip.
const device = await getDevice();

// Distance fallen from rest after n substeps of dt seconds: a * dt^2 * n(n+1)/2,
// where gravity a is 2000 * radius.
function drop(substeps: number, substepRate = SUBSTEP_RATE) {
  const dt = 1 / substepRate;
  return 2000 * RADIUS * dt * dt * ((substeps * (substeps + 1)) / 2);
}

// 20 substeps at 1200 per second: one 60 Hz frame.
const FRAME = 20;
const ONE_FRAME_DROP = drop(FRAME);

describe.skipIf(!device)('one particle', () => {
  test('falls under gravity along +y', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(FRAME);
    const [p] = await sim.read();
    expect(ONE_FRAME_DROP).toBeCloseTo(0.4375, 10);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(ONE_FRAME_DROP, 5);
  });

  test('falls by the hand-computed distance after a given number of substeps', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(7);
    const [p] = await sim.read();
    // 3000 * (1/1200)^2 * 28
    expect(p.y).toBeCloseTo(0.0583333, 5);
  });

  test('the substep rate sets the length of a substep', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(FRAME, { substepRate: 2400 });
    const [p] = await sim.read();
    // 3000 * (1/2400)^2 * 210: a quarter of the fall at 1200 per second.
    expect(p.y).toBeCloseTo(0.109375, 5);
  });

  test('how the substeps are split between calls does not change the result', async () => {
    const together = await createSim([{ x: 0, y: 0 }]);
    together.step(FRAME);
    const apart = await createSim([{ x: 0, y: 0 }]);
    for (let i = 0; i < FRAME; i++) apart.step(1);
    expect(await apart.read()).toEqual(await together.read());
  });

  test('zero substeps leaves the particles where they are', async () => {
    const sim = await createSim([{ x: 3, y: 4 }]);
    sim.step(0);
    const [p] = await sim.read();
    expect([p.x, p.y]).toEqual([3, 4]);
  });

  test('falls the same distance with collision off', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(FRAME, { collide: false });
    const [p] = await sim.read();
    expect(p.y).toBeCloseTo(ONE_FRAME_DROP, 5);
  });

  test('a positive click force pulls toward the click point and replaces gravity', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(FRAME, { clickX: 100, clickY: 0, clickForce: 2000 });
    const [p] = await sim.read();
    expect(p.x).toBeCloseTo(ONE_FRAME_DROP, 5);
    expect(p.y).toBe(0);
  });

  test('a negative click force pushes away from the click point', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(FRAME, { clickX: 100, clickY: 0, clickForce: -2000 });
    const [p] = await sim.read();
    expect(p.x).toBeCloseTo(-ONE_FRAME_DROP, 5);
    expect(p.y).toBe(0);
  });
});

describe.skipIf(!device)('two overlapping particles', () => {
  const pair = [
    { x: -1, y: 0 },
    { x: 1, y: 0 }
  ];

  test('are pushed apart symmetrically when collision is on', async () => {
    const sim = await createSim(pair);
    sim.step(FRAME);
    const [a, b] = await sim.read();
    expect(b.x - a.x).toBeGreaterThanOrEqual(2 * RADIUS);
    expect(a.x + b.x).toBeCloseTo(0, 4);
    // Collision only acts along the line between them; both still fall alike.
    expect(a.y).toBeCloseTo(ONE_FRAME_DROP, 5);
    expect(b.y).toBeCloseTo(ONE_FRAME_DROP, 5);
  });

  test('pass through each other when collision is off', async () => {
    const sim = await createSim(pair);
    sim.step(5 * FRAME, { collide: false });
    const [a, b] = await sim.read();
    expect(a.x).toBe(-1);
    expect(b.x).toBe(1);
    expect(a.y).toBe(b.y);
  });
});

describe.skipIf(!device)('the boundary circle', () => {
  const edge = DEFAULT_CONSTRAIN_RADIUS - RADIUS;
  // Just inside the bottom of the circle, moving down at 0.5 per substep.
  const falling = [{ x: 0, y: 1050, prevX: 0, prevY: 1049.5 }];

  test('classic constrain stops the particle at the edge', async () => {
    const sim = await createSim(falling);
    sim.step(FRAME, { classicConstrain: true });
    const [p] = await sim.read();
    expect(p.y).toBeGreaterThan(edge - 0.01);
    expect(p.y).toBeLessThan(edge + 0.01);
  });

  test('reflective constrain bounces the particle back inward', async () => {
    const sim = await createSim(falling);
    sim.step(FRAME, { classicConstrain: false });
    const [p] = await sim.read();
    expect(p.y).toBeLessThan(edge);
    expect(p.y).toBeLessThan(p.prevY);
  });

  test.each([true, false])('the particle comes to rest at the edge (classic: %s)', async (classicConstrain) => {
    const sim = await createSim(falling);
    sim.step(126 * FRAME, { classicConstrain });
    const [p] = await sim.read();
    expect(p.y).toBeGreaterThan(edge - 0.01);
    expect(p.y).toBeLessThan(edge + 0.01);
    expect(Math.abs(p.y - p.prevY)).toBeLessThan(0.01);
  });

  test('a smaller constrain radius moves the edge', async () => {
    const sim = await createSim([{ x: 0, y: 490 }]);
    sim.step(126 * FRAME, { constrainRadius: 500, classicConstrain: true });
    const [p] = await sim.read();
    expect(p.y).toBeGreaterThan(500 - RADIUS - 0.01);
    expect(p.y).toBeLessThan(500 - RADIUS + 0.01);
  });
});

describe.skipIf(!device)('binning', () => {
  test('puts every particle in exactly one bin list', async () => {
    const count = 15000;
    const sim = await createSim(seededScatter(count, 99));
    const { heads, links } = await sim.readBinLists();

    const seen = new Uint8Array(count);
    let visited = 0;
    for (const head of heads) {
      for (let i = head; i !== -1; i = links[i]) {
        expect(seen[i]).toBe(0);
        seen[i] = 1;
        visited++;
      }
    }
    expect(visited).toBe(count);
  });
});

// The full app scenario. Binning uses atomics, so the order particles are
// visited in, and therefore float rounding, differs between runs. Individual
// positions are not reproducible; these aggregate measures are. The ranges are
// measured values, widened to several times the run-to-run spread seen across
// four runs. The same ranges held on the code before the 2026-11 refactor, for
// an equivalent seeded start.
describe.skipIf(!device)('15,000 seeded particles', () => {
  test('after one frame the aggregate state matches the recorded baseline', async () => {
    const sim = await createSim(seededScatter(15000, 1234));
    sim.step(FRAME);
    const stats = runStats(await sim.read());

    expect(stats.nonFinite).toBe(0);
    expect(stats.centreX).toBeCloseTo(-2.565, 1); // within 0.05
    expect(stats.centreY).toBeCloseTo(3.053, 1);
    expect(stats.meanDistance).toBeCloseTo(786.036, 1);
    expect(stats.meanSpeed).toBeCloseTo(0.2539, 2); // within 0.005
  });

  test('settles into a pile at the bottom of the circle', async () => {
    const sim = await createSim(seededScatter(15000, 1234));
    sim.step(300 * FRAME);
    const stats = runStats(await sim.read());

    expect(stats.nonFinite).toBe(0);
    // Every particle ends inside the boundary circle.
    expect(stats.maxDistance).toBeLessThan(DEFAULT_CONSTRAIN_RADIUS - RADIUS + 0.1);
    // At rest.
    expect(stats.meanSpeed).toBeLessThan(0.05);
    // Piled at the bottom (+y), roughly centred. Measured: centreY 968.5 to 969.2.
    expect(stats.centreY).toBeGreaterThan(966);
    expect(stats.centreY).toBeLessThan(972);
    expect(Math.abs(stats.centreX)).toBeLessThan(40);
    // Measured: 1005.2 to 1009.4.
    expect(stats.meanDistance).toBeGreaterThan(1001);
    expect(stats.meanDistance).toBeLessThan(1014);
    // Collisions resolved to a small residual overlap. Measured: mean 0.088 to
    // 0.094, max 0.72 to 0.82, about 41,700 touching pairs.
    expect(stats.meanOverlap).toBeLessThan(0.13);
    expect(stats.maxOverlap).toBeLessThan(1.5);
    expect(stats.overlapPairs).toBeGreaterThan(39000);
    expect(stats.overlapPairs).toBeLessThan(44000);
  });

  test('without collision the particles collapse onto the boundary', async () => {
    const sim = await createSim(seededScatter(15000, 1234));
    sim.step(300 * FRAME, { collide: false });
    const stats = runStats(await sim.read());

    expect(stats.nonFinite).toBe(0);
    // Nothing holds them apart, so far more of them overlap than when colliding.
    expect(stats.overlapPairs).toBeGreaterThan(100000);
  });
});

describe.skipIf(!device)('particle rendering', () => {
  test('draws each particle as a disc of its colour at its position', async () => {
    // A 256x144 image of the 3840x2160 space: 15 simulation units per pixel.
    const sim = await createSim([
      { x: 0, y: 0, radius: 150, rgb: [0, 1, 0] },
      { x: -1200, y: -600, radius: 150, rgb: [1, 0, 0] }
    ]);
    const pixel = await sim.render(256, 144);

    expect(pixel(128, 72)).toEqual([0, 255, 0]);
    expect(pixel(48, 32)).toEqual([255, 0, 0]);
    // Background, and the mirror position of the red particle (y is not flipped).
    expect(pixel(5, 5)).toEqual([0, 0, 0]);
    expect(pixel(48, 112)).toEqual([0, 0, 0]);
  });

  test('a wider canvas shows the simulation centred, with black bars at the sides', async () => {
    const sim = await createSim([
      { x: 0, y: 0, radius: 150, rgb: [0, 1, 0] },
      // Hard against the left edge of simulation space.
      { x: -1800, y: 0, radius: 100, rgb: [1, 0, 0] }
    ]);
    // 144 rows fit a 256-wide image, so a 400-wide canvas has 72-pixel bars.
    const pixel = await sim.render(400, 144);

    expect(pixel(200, 72)).toEqual([0, 255, 0]);
    expect(pixel(72 + 8, 72)).toEqual([255, 0, 0]);
    expect(pixel(36, 72)).toEqual([0, 0, 0]);
    expect(pixel(399 - 36, 72)).toEqual([0, 0, 0]);
  });

  test('a canvas with no area is skipped without asking for a canvas view or drawing', async () => {
    const target = new SimulationTarget(device, { width: 3840, height: 2160, format: 'bgra8unorm' });
    try {
      const never = () => {
        throw new Error('nothing should be presented to a canvas with no area');
      };
      for (const [width, height] of [[0, 0], [800, 0], [NaN, 600]]) {
        target.resize(width, height);
        target.render(device.createCommandEncoder(), never, never);
        expect(target.toSimulation(10, 10)).toEqual([0, 0]);
      }
    } finally {
      target.destroy();
    }
  });

  test('a taller canvas shows the simulation centred, with black bars above and below', async () => {
    const sim = await createSim([{ x: 0, y: 0, radius: 150, rgb: [0, 1, 0] }]);
    const pixel = await sim.render(256, 344);

    expect(pixel(128, 172)).toEqual([0, 255, 0]);
    expect(pixel(128, 50)).toEqual([0, 0, 0]);
    expect(pixel(128, 343 - 50)).toEqual([0, 0, 0]);
  });
});
