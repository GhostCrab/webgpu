import { describe, expect, test } from 'vitest';

import { getDevice } from './gpu';

import { SimulationTarget } from '../src/simulation-target';
import { binGrid } from '../src/verlet/verlet-bin-computer';
import {
  BOUNDS,
  createSim as createAnySim,
  DEFAULT_CONSTRAIN_RADIUS,
  PIPELINES,
  RADIUS,
  runStats,
  mulberry32,
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

/** A speed in simulation units per second, as a move over one substep at the default rate. */
const perSubstep = (speed: number) => speed / SUBSTEP_RATE;
/** A move over one substep at the default rate, as a speed in simulation units per second. */
const perSecond = (move: number) => move * SUBSTEP_RATE;

/** Makes sims on the current pipeline, unless a test asks for another. */
const createSim: typeof createAnySim = (particles, options) =>
  createAnySim(particles, { pipeline: 'current', ...options });

// The behaviour both pipelines share is judged by the same tests.
describe.skipIf(!device).each(PIPELINES)('the %s pipeline', (pipeline) => {
const createSim: typeof createAnySim = (particles, options) =>
  createAnySim(particles, { pipeline, ...options });

describe('one particle', () => {
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

// No particle moves further than the smallest particle's radius in one
// substep. The last thing a substep does is move each particle, so after a
// substep the gap between position and previous position is that move.
describe('the speed limit', () => {
  const small = 1;
  const distance = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y);

  test('a fast particle moves no further than the smallest radius per substep', async () => {
    // 40 units per substep to the right, which stays clear of the boundary
    // circle for a whole frame; the smallest radius is 1.
    const sim = await createSim([
      { x: 0, y: 0, vx: perSecond(40), radius: 3 },
      { x: 0, y: 500, radius: small }
    ]);
    sim.step(1, { collide: false });
    let [p] = await sim.read();
    // Shortened to exactly the limit, still heading right.
    expect(distance(p, { x: 0, y: 0 })).toBeCloseTo(small, 4);
    expect(p.x).toBeGreaterThan(0.99);
    expect(perSubstep(Math.hypot(p.vx, p.vy))).toBeCloseTo(small, 4);

    sim.step(FRAME - 1, { collide: false });
    [p] = await sim.read();
    expect(perSubstep(Math.hypot(p.vx, p.vy))).toBeLessThanOrEqual(small + 1e-4);
    expect(distance(p, { x: 0, y: 0 })).toBeLessThanOrEqual(FRAME * small + 1e-3);
  });

  test('the strongest click force, held, saturates at the limit', async () => {
    const sim = await createSim([
      { x: -800, y: 0 },
      { x: 0, y: -800 },
      { x: 300, y: 300 }
    ]);
    // 10,000 is the most the settings panel allows. Every substep's move is
    // checked, for 30 frames' worth of substeps.
    for (let substep = 0; substep < 30 * FRAME; substep++) {
      sim.step(1, { clickX: 0, clickY: 0, clickForce: 10000 });
      for (const p of await sim.read()) {
        expect(Number.isFinite(p.x + p.y + p.vx + p.vy)).toBe(true);
        expect(perSubstep(Math.hypot(p.vx, p.vy))).toBeLessThanOrEqual(RADIUS + 1e-4);
      }
    }
  });
});

describe('a particle exactly at the click point', () => {
  test.each([2000, -2000])('receives no click force and stays finite (force %s)', async (clickForce) => {
    const sim = await createSim([{ x: 100, y: 50 }]);
    sim.step(FRAME, { clickX: 100, clickY: 50, clickForce });
    const [p] = await sim.read();
    expect([p.x, p.y, p.vx, p.vy]).toEqual([100, 50, 0, 0]);
  });
});

describe('the boundary circle', () => {
  const edge = DEFAULT_CONSTRAIN_RADIUS - RADIUS;
  // Just inside the bottom of the circle, moving down at 0.5 per substep.
  const falling = [{ x: 0, y: 1050, vy: perSecond(0.5) }];

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
    expect(p.vy).toBeLessThan(0);
  });

  test.each([true, false])('the particle comes to rest at the edge (classic: %s)', async (classicConstrain) => {
    const sim = await createSim(falling);
    sim.step(126 * FRAME, { classicConstrain });
    const [p] = await sim.read();
    expect(p.y).toBeGreaterThan(edge - 0.01);
    expect(p.y).toBeLessThan(edge + 0.01);
    expect(Math.abs(perSubstep(p.vy))).toBeLessThan(0.01);
  });

  test.each([true, false])(
    'a particle crossing the boundary circle ends the substep on it, not past it (classic: %s)',
    async (classicConstrain) => {
      // Moving +x at 0.5 per substep, it would end this substep 0.25 past the edge.
      const sim = await createSim([{ x: edge - 0.25, y: 0, vx: perSecond(0.5) }]);
      sim.step(1, { classicConstrain });
      const [p] = await sim.read();
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(edge + 0.001);
    }
  );

  test('reflective constrain: a head-on impact returns the particle inward at 0.8 of its speed', async () => {
    const sim = await createSim([{ x: edge - 0.25, y: 0, vx: perSecond(0.5) }]);
    sim.step(1);
    const [p] = await sim.read();
    expect(p.x).toBeCloseTo(edge, 3);
    expect(perSubstep(p.vx)).toBeCloseTo(-0.4, 3);
  });

  test('reflective constrain: a glancing impact keeps its speed along the boundary', async () => {
    // At the bottom of the circle, moving +x at 0.5 and outward (+y) at 0.2 per
    // substep. Gravity adds 3000 / 1200^2 = 0.0021 to the outward speed, so
    // 0.8 of 0.2021 comes back inward; the speed along the boundary is kept.
    const sim = await createSim([{ x: 0, y: edge - 0.1, vx: perSecond(0.5), vy: perSecond(0.2) }]);
    sim.step(1);
    const [p] = await sim.read();
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(edge + 0.001);
    expect(perSubstep(p.vx)).toBeCloseTo(0.5, 3);
    expect(perSubstep(p.vy)).toBeCloseTo(-0.1617, 3);
  });

  test('reflective constrain: a particle outside the circle and moving inward is not reflected', async () => {
    const sim = await createSim([{ x: edge + 5, y: 0, vx: perSecond(-0.5) }]);
    sim.step(1);
    const [p] = await sim.read();
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(edge + 0.001);
    expect(perSubstep(p.vx)).toBeCloseTo(-0.5, 3);
  });

  test.each([true, false])(
    'a particle far outside the circle returns to the edge without crossing it (classic: %s)',
    async (classicConstrain) => {
      // GitHub issue #2: at rest 400 past the edge, it was flung to the far side.
      const sim = await createSim([{ x: 0, y: 900 }]);
      sim.step(FRAME, { constrainRadius: 500, classicConstrain });
      const [p] = await sim.read();
      expect(p.y).toBeGreaterThan(500 - RADIUS - 0.01);
      expect(p.y).toBeLessThan(500 - RADIUS + 0.01);
      expect(perSubstep(Math.hypot(p.vx, p.vy))).toBeLessThan(0.01);
    }
  );

  test.each([true, false])(
    'the boundary circle can be centred away from the origin (classic: %s)',
    async (classicConstrain) => {
      // Falling at 0.5 per substep onto the bottom of a circle centred at (400, 0).
      const sim = await createSim([{ x: 400, y: 490, vy: perSecond(0.5) }]);
      sim.step(FRAME, { constrainCenter: [400, 0], constrainRadius: 500, classicConstrain });
      const [p] = await sim.read();
      expect(Math.hypot(p.x - 400, p.y)).toBeLessThanOrEqual(500 - RADIUS + 0.001);
      expect(p.y).toBeGreaterThan(490);
      // The boundary's normal at the bottom is vertical, so nothing moves it sideways.
      expect(p.x).toBeCloseTo(400, 3);
      expect(perSubstep(p.vx)).toBeCloseTo(0, 3);
    }
  );

  test('a smaller constrain radius moves the edge', async () => {
    const sim = await createSim([{ x: 0, y: 490 }]);
    sim.step(126 * FRAME, { constrainRadius: 500, classicConstrain: true });
    const [p] = await sim.read();
    expect(p.y).toBeGreaterThan(500 - RADIUS - 0.01);
    expect(p.y).toBeLessThan(500 - RADIUS + 0.01);
  });
});

describe('two overlapping particles', () => {
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

  test('separate along a fixed direction, and stay finite, when exactly coincident', async () => {
    const sim = await createSim([
      { x: 10, y: 0 },
      { x: 10, y: 0 }
    ]);
    sim.step(FRAME);
    const [a, b] = await sim.read();
    for (const p of [a, b]) {
      expect(Number.isFinite(p.x + p.y + p.vx + p.vy)).toBe(true);
    }
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(RADIUS);
    expect(a.x + b.x).toBeCloseTo(20, 4);
    expect(a.y).toBeCloseTo(b.y, 5);
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
});

describe.skipIf(!device)('only the new pipeline', () => {
  test('particles of different radii fall at the same rate', async () => {
    const sim = await createSim(
      [
        { x: -100, y: 0, radius: 1 },
        { x: 0, y: 0, radius: RADIUS },
        { x: 100, y: 0, radius: 6 }
      ],
      { pipeline: 'new' }
    );
    sim.step(FRAME);
    for (const p of await sim.read()) {
      expect(p.y).toBeCloseTo(ONE_FRAME_DROP, 5);
      expect(perSubstep(p.vy)).toBeCloseTo(drop(FRAME) - drop(FRAME - 1), 5);
    }
  });

  test('reads particles back ordered by particle id, with their velocity', async () => {
    const sim = await createSim(
      [
        { x: 0, y: 0, vx: 600, rgb: [1, 0, 0] },
        { x: 50, y: 0, vx: -300, rgb: [0, 1, 0] },
        { x: 100, y: 0, rgb: [0, 0, 1] }
      ],
      { pipeline: 'new' }
    );
    sim.step(1);
    const particles = await sim.read();
    expect(particles.map((p) => p.id)).toEqual([0, 1, 2]);
    expect(particles.map((p) => p.vx)).toEqual([600, -300, 0]);
    // One substep of gravity, 3000 units per second squared.
    for (const p of particles) expect(p.vy).toBeCloseTo(2.5, 4);
    expect(particles.map((p) => p.rgb)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]);
  });
});

// Collisions in the new pipeline: the Jacobi gather and the velocity update.
describe.skipIf(!device)('collisions in the new pipeline', () => {
  const createNewSim: typeof createAnySim = (particles, options) =>
    createAnySim(particles, { pipeline: 'new', ...options });
  const mass = (p: { radius: number }) => p.radius * p.radius;

  // Two free particles on the x axis, closing head-on at 1200 units per
  // second. Gravity acts on both alike, along y, so it leaves x alone.
  const headOn = (left: number, right: number) => [
    { x: -10, y: 0, vx: 600, radius: left },
    { x: 10, y: 0, vx: -600, radius: right }
  ];

  test.each([
    [1.5, 1.5],
    [1.5, 3],
    [1, 4]
  ])('conserve momentum in a head-on collision (radii %s and %s)', async (left, right) => {
    const before = headOn(left, right);
    const sim = await createNewSim(before);
    sim.step(3 * FRAME);
    const [a, b] = await sim.read();
    // They have met and parted.
    expect(b.vx - a.vx).toBeGreaterThan(0);
    const momentum = (ps: { radius: number; vx: number }[]) =>
      ps.reduce((sum, p) => sum + mass(p) * p.vx, 0);
    const scale = mass(before[0]) * 600 + mass(before[1]) * 600;
    expect(Math.abs(momentum([a, b]) - momentum(before)) / scale).toBeLessThan(1e-4);
    // Collision acts along the line between them only.
    expect(a.vy).toBeCloseTo(b.vy, 3);
  });

  test.each([0, 0.25, 0.5, 1])(
    'a head-on collision keeps the fraction of relative speed the restitution states (%s)',
    async (particleRestitution) => {
      const sim = await createNewSim(headOn(1.5, 3));
      sim.step(3 * FRAME, { particleRestitution });
      const [a, b] = await sim.read();
      expect((b.vx - a.vx) / 1200).toBeCloseTo(particleRestitution, 3);
    }
  );

  test('a glancing collision loses the fraction of speed along the contact the damping states', async () => {
    // Closing along x at 1 unit per substep and sliding past each other along
    // y. They first overlap after 18 substeps, by then level with each other,
    // so the contact is along x. Both fall alike, so gravity leaves their
    // relative velocity alone.
    const sim = await createNewSim([
      { x: -10, y: -4.5, vx: 600, vy: 300 },
      { x: 10, y: 4.5, vx: -600, vy: -300 }
    ]);
    sim.step(3 * FRAME, { particleRestitution: 0.5, particleDamping: 0.25 });
    const [a, b] = await sim.read();
    expect((b.vx - a.vx) / 1200).toBeCloseTo(0.5, 2);
    expect((a.vy - b.vy) / 600).toBeCloseTo(0.75, 2);
  });

  test('two coincident particles of unequal radii separate and stay finite', async () => {
    const sim = await createNewSim([
      { x: 10, y: 0, radius: 1 },
      { x: 10, y: 0, radius: 4 }
    ]);
    sim.step(FRAME);
    const [a, b] = await sim.read();
    for (const p of [a, b]) {
      expect(Number.isFinite(p.x + p.y + p.vx + p.vy)).toBe(true);
    }
    expect(Math.abs(b.x - a.x)).toBeGreaterThanOrEqual(5 - 1e-3);
    // The smaller particle, with a sixteenth of the mass, moves the most.
    expect(Math.abs(a.x - 10)).toBeGreaterThan(Math.abs(b.x - 10));
  });

  // Settled piles at the app's substep rate of 2400 per second, after 5 s of
  // simulated time. Runs are reproducible, so the ranges below are measured
  // over four scatter seeds (1234, 1, 99, 7) and widened to several times
  // their spread.
  const PILE_RATE = 2400;
  const SETTLE = 5 * PILE_RATE;

  /** The app's scatter, with radii from 0.75 to 3: a ratio of 4. */
  function mixedScatter(count: number, seed: number) {
    const random = mulberry32(seed + 1);
    return seededScatter(count, seed).map((p, i) => ({
      ...p,
      radius: i === 0 ? 0.75 : i === 1 ? 3 : 0.75 + 2.25 * random()
    }));
  }

  async function settledPile(particles: { radius?: number }[]) {
    const sim = await createNewSim(particles as Parameters<typeof createNewSim>[0]);
    sim.step(SETTLE, { substepRate: PILE_RATE });
    const settled = await sim.read();
    const smallest = Math.min(...settled.map((p) => p.radius));
    // Every particle inside the boundary circle, and none faster than the
    // speed limit: the smallest radius per substep.
    for (const p of settled) {
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(DEFAULT_CONSTRAIN_RADIUS - p.radius + 1e-3);
      expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(smallest * PILE_RATE * (1 + 1e-5));
    }
    return runStats(settled);
  }

  test('15,000 particles settle into a resting pile', async () => {
    const stats = await settledPile(seededScatter(15000, 1234));
    expect(stats.nonFinite).toBe(0);
    // Piled at the bottom (+y). Measured: centreY 970.6 to 970.9.
    expect(stats.centreY).toBeGreaterThan(967);
    expect(stats.centreY).toBeLessThan(974);
    // Measured: mean 0.082 to 0.087, max 0.59 to 0.62, 41,600 to 42,100 touching pairs.
    expect(stats.meanOverlap).toBeLessThan(0.11);
    expect(stats.maxOverlap).toBeLessThan(1.0);
    expect(stats.overlapPairs).toBeGreaterThan(39000);
    expect(stats.overlapPairs).toBeLessThan(45000);
    // Measured: 16 to 52 units per second.
    expect(stats.meanSpeed).toBeLessThan(150);
  });

  test('particles with radii spanning a ratio of 4 settle into a resting pile', async () => {
    const stats = await settledPile(mixedScatter(8000, 1234));
    expect(stats.nonFinite).toBe(0);
    // Measured: centreY 971.0 to 972.2.
    expect(stats.centreY).toBeGreaterThan(968);
    expect(stats.centreY).toBeLessThan(976);
    // Measured: mean 0.080 to 0.084, max 0.65 to 0.88, 17,700 to 17,900 touching pairs.
    expect(stats.meanOverlap).toBeLessThan(0.11);
    expect(stats.maxOverlap).toBeLessThan(1.5);
    expect(stats.overlapPairs).toBeGreaterThan(16000);
    expect(stats.overlapPairs).toBeLessThan(19500);
    // Measured: 50 to 58 units per second.
    expect(stats.meanSpeed).toBeLessThan(150);
  });

  test('a multi-particle scene run twice gives identical particles', async () => {
    const run = async () => {
      const sim = await createNewSim(mixedScatter(8000, 99));
      sim.step(PILE_RATE, { substepRate: PILE_RATE });
      return sim.read();
    };
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
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

  test('puts a particle outside the bin grid in the nearest edge bin', async () => {
    const { width, height, binSize } = binGrid(BOUNDS, 2 * RADIUS);
    const edge = (width * binSize) / 2;
    // Beyond the right, left and bottom edges, and beyond a corner, each in a
    // row or column where a wrapped index would land in the wrong bin.
    const outside = [
      { x: edge + 50, y: 0 },
      { x: -edge - 50, y: 100 },
      { x: 200, y: edge + 50 },
      { x: -edge - 5000, y: -edge - 5000 }
    ];
    const expected = [
      [width - 1, height / 2],
      [0, height / 2 + Math.floor(100 / binSize)],
      [width / 2 + Math.floor(200 / binSize), height - 1],
      [0, 0]
    ];
    const sim = await createSim([...outside, { x: 0, y: 0 }]);
    const { heads, links } = await sim.readBinLists();

    const binOf = new Map<number, [number, number]>();
    for (let bin = 0; bin < heads.length; bin++) {
      for (let i = heads[bin]; i !== -1; i = links[i]) {
        expect(binOf.has(i)).toBe(false);
        binOf.set(i, [bin % width, Math.floor(bin / width)]);
      }
    }
    expect(binOf.size).toBe(outside.length + 1);
    expect(outside.map((_, i) => binOf.get(i))).toEqual(expected);
  });
});

// The full app scenario. Binning uses atomics, so the order particles are
// visited in, and therefore float rounding, differs between runs. Individual
// positions are not reproducible; these aggregate measures are. The ranges are
// measured values, widened to several times the run-to-run spread seen across
// four runs. They were last re-measured with the speed limit, the non-finite
// guards and the reflective constrain as a true bounce all in place.
describe.skipIf(!device)('15,000 seeded particles', () => {
  test('after one frame the aggregate state matches the recorded baseline', async () => {
    const sim = await createSim(seededScatter(15000, 1234));
    sim.step(FRAME);
    const stats = runStats(await sim.read());

    expect(stats.nonFinite).toBe(0);
    expect(stats.centreX).toBeCloseTo(-2.403, 1); // within 0.05
    expect(stats.centreY).toBeCloseTo(3.114, 1);
    expect(stats.meanDistance).toBeCloseTo(787.063, 1);
    expect(perSubstep(stats.meanSpeed)).toBeCloseTo(0.3651, 2); // within 0.005
  });

  test('settles into a pile at the bottom of the circle', async () => {
    const sim = await createSim(seededScatter(15000, 1234));
    sim.step(300 * FRAME);
    const stats = runStats(await sim.read());

    expect(stats.nonFinite).toBe(0);
    // Every particle ends inside the boundary circle.
    expect(stats.maxDistance).toBeLessThan(DEFAULT_CONSTRAIN_RADIUS - RADIUS + 0.1);
    // At rest.
    expect(perSubstep(stats.meanSpeed)).toBeLessThan(0.05);
    // Piled at the bottom (+y), roughly centred. Measured: centreY 970.4 to 970.7.
    expect(stats.centreY).toBeGreaterThan(967);
    expect(stats.centreY).toBeLessThan(974);
    expect(Math.abs(stats.centreX)).toBeLessThan(40);
    // Measured: 1003.4 to 1004.5.
    expect(stats.meanDistance).toBeGreaterThan(999);
    expect(stats.meanDistance).toBeLessThan(1009);
    // Collisions resolved to a small residual overlap. Measured: mean 0.085 to
    // 0.089, max 0.81 to 0.91, about 42,200 touching pairs.
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
  test.each(PIPELINES)('draws each particle as a disc of its colour at its position (%s pipeline)', async (pipeline) => {
    // A 256x144 image of the 3840x2160 space: 15 simulation units per pixel.
    const sim = await createSim(
      [
        { x: 0, y: 0, radius: 150, rgb: [0, 1, 0] },
        { x: -1200, y: -600, radius: 150, rgb: [1, 0, 0] }
      ],
      { pipeline }
    );
    const pixel = await sim.render(256, 144);

    expect(pixel(128, 72)).toEqual([0, 255, 0]);
    expect(pixel(48, 32)).toEqual([255, 0, 0]);
    // Background, and the mirror position of the red particle (y is not flipped).
    expect(pixel(5, 5)).toEqual([0, 0, 0]);
    expect(pixel(48, 112)).toEqual([0, 0, 0]);
  });

  test('particles keep their colours while the new pipeline reorders them every substep', async () => {
    // Bin order runs left to right; particle id order does not.
    const sim = await createSim(
      [
        { x: 900, y: 0, radius: 150, rgb: [1, 0, 0] },
        { x: -900, y: 0, radius: 150, rgb: [0, 1, 0] },
        { x: 0, y: 0, radius: 150, rgb: [0, 0, 1] }
      ],
      { pipeline: 'new' }
    );
    // An odd number of substeps, so the particles end in the other buffer.
    sim.step(3);
    const pixel = await sim.render(256, 144);

    expect(pixel(128 + 60, 72)).toEqual([255, 0, 0]);
    expect(pixel(128 - 60, 72)).toEqual([0, 255, 0]);
    expect(pixel(128, 72)).toEqual([0, 0, 255]);
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
