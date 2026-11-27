import { describe, expect, test } from 'vitest';

import { getDevice } from './gpu';

import { createSim, RADIUS, seededScatter, SUBSTEP_RATE } from './sim-harness';

// These tests run the real WGSL pipelines on a real GPU. Without one they skip.
const device = await getDevice();

const DT = 1 / SUBSTEP_RATE;
const NO_GRAVITY: [number, number] = [0, 0];

describe.skipIf(!device)('gravity', () => {
  test('pulls along the direction it is given', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(7, { gravity: [3000, 0] });
    const [p] = await sim.read();
    // 3000 * (1/1200)^2 * 28, along +x this time.
    expect(p.x).toBeCloseTo(0.0583333, 5);
    expect(p.y).toBe(0);
  });

  test('of zero leaves a particle at rest', async () => {
    const sim = await createSim([{ x: 10, y: 20 }]);
    sim.step(20, { gravity: NO_GRAVITY });
    const [p] = await sim.read();
    expect([p.x, p.y, p.vx, p.vy]).toEqual([10, 20, 0, 0]);
  });
});

describe.skipIf(!device)('a moving boundary circle', () => {
  // At rest just past the bottom of a circle of radius 500.
  const pastEdge = [{ x: 0, y: 500 - RADIUS + 0.1 }];

  test('closing on a particle bounces it off as seen from the circle (reflective)', async () => {
    const sim = await createSim(pastEdge);
    sim.step(1, { constrainRadius: 500, gravity: NO_GRAVITY, constrainVelocity: [0, -600] });
    const [p] = await sim.read();
    // As seen from the circle it closes at 600 and leaves at 0.8 of that:
    // -480, plus the circle's own -600.
    expect(p.vy).toBeCloseTo(-1080, 2);
    expect(p.y).toBeCloseTo(500 - RADIUS, 3);
  });

  test('closing on a particle carries it along (classic)', async () => {
    const sim = await createSim(pastEdge);
    sim.step(1, {
      constrainRadius: 500,
      classicConstrain: true,
      gravity: NO_GRAVITY,
      constrainVelocity: [0, -600]
    });
    const [p] = await sim.read();
    expect(p.vy).toBeCloseTo(-600, 2);
  });

  test('moving away does not pull a particle with it', async () => {
    const sim = await createSim(pastEdge);
    sim.step(1, { constrainRadius: 500, gravity: NO_GRAVITY, constrainVelocity: [0, 600] });
    const [p] = await sim.read();
    expect(p.vy).toBeCloseTo(0, 4);
  });
});

describe.skipIf(!device)('a stir', () => {
  const stir = {
    kind: 'stir' as const,
    center: [0, 0] as [number, number],
    radius: 100,
    velocity: [1000, 0] as [number, number],
    rate: 30
  };

  test('draws velocity toward its own, by the falloff at that distance', async () => {
    const sim = await createSim([{ x: 50, y: 0 }]);
    sim.step(1, { gravity: NO_GRAVITY, toolEffect: stir });
    const [p] = await sim.read();
    // Halfway out the falloff is (1 - 0.5)^2 = 0.25: 0.25 * 30 * dt of the way to 1000.
    expect(p.vx).toBeCloseTo(1000 * 0.25 * 30 * DT, 3);
    expect(p.vy).toBe(0);
  });

  test('leaves particles outside its radius alone', async () => {
    const sim = await createSim([{ x: 150, y: 0 }]);
    sim.step(1, { gravity: NO_GRAVITY, toolEffect: stir });
    const [p] = await sim.read();
    expect([p.vx, p.vy]).toEqual([0, 0]);
  });
});

describe.skipIf(!device)('a vortex', () => {
  test.each([
    [1000, 1],
    [-1000, -1]
  ])('of strength %d swirls and pulls inward', async (strength, spin) => {
    const sim = await createSim([{ x: 50, y: 0 }]);
    sim.step(1, {
      gravity: NO_GRAVITY,
      toolEffect: { kind: 'vortex', center: [0, 0], radius: 100, strength }
    });
    const [p] = await sim.read();
    // Halfway out, the falloff is 0.5. To the right of the centre the swirl
    // points down (+y) for positive strength: clockwise as drawn. The pull
    // is 0.35 of the strength's size, toward the centre.
    expect(p.vx).toBeCloseTo(-0.35 * 1000 * 0.5 * DT, 4);
    expect(p.vy).toBeCloseTo(spin * 1000 * 0.5 * DT, 4);
  });
});

describe.skipIf(!device)('a shockwave', () => {
  const shockwave = {
    kind: 'shockwave' as const,
    center: [0, 0] as [number, number],
    ringRadius: 100,
    width: 20,
    strength: 12000
  };

  test('pushes the particles on its ring outward', async () => {
    const sim = await createSim([
      { x: 100, y: 0 },
      { x: 0, y: -110 }
    ]);
    sim.step(1, { gravity: NO_GRAVITY, toolEffect: shockwave });
    const [onRing, halfIn] = await sim.read();
    expect(onRing.vx).toBeCloseTo(12000 * DT, 3);
    expect(onRing.vy).toBe(0);
    // 10 off the ring's middle, half the width: half the strength, outward (-y).
    expect(halfIn.vy).toBeCloseTo(-6000 * DT, 3);
  });

  test('of negative strength pushes inward', async () => {
    const sim = await createSim([{ x: 100, y: 0 }]);
    sim.step(1, { gravity: NO_GRAVITY, toolEffect: { ...shockwave, strength: -12000 } });
    const [p] = await sim.read();
    expect(p.vx).toBeCloseTo(-12000 * DT, 3);
  });

  test('leaves particles off its ring alone', async () => {
    const sim = await createSim([
      { x: 50, y: 0 },
      { x: 150, y: 0 }
    ]);
    sim.step(1, { gravity: NO_GRAVITY, toolEffect: shockwave });
    for (const p of await sim.read()) expect([p.vx, p.vy]).toEqual([0, 0]);
  });
});

describe.skipIf(!device)('an obstacle', () => {
  const obstacle = {
    kind: 'obstacle' as const,
    center: [0, 0] as [number, number],
    radius: 50,
    velocity: [600, 0] as [number, number]
  };

  test('pushes a particle out to its edge, bouncing it as seen from the obstacle', async () => {
    const sim = await createSim([{ x: 10, y: 0 }]);
    sim.step(1, { gravity: NO_GRAVITY, toolEffect: obstacle });
    const [p] = await sim.read();
    expect(p.x).toBeCloseTo(50 + RADIUS, 4);
    // It closes at 600 as seen from the obstacle and leaves at 0.3 of that:
    // 180, plus the obstacle's own 600.
    expect(p.vx).toBeCloseTo(780, 2);
  });

  test('sends a particle at its centre out along +x', async () => {
    const sim = await createSim([{ x: 0, y: 0 }]);
    sim.step(1, { gravity: NO_GRAVITY, toolEffect: { ...obstacle, velocity: [0, 0] } });
    const [p] = await sim.read();
    expect(p.x).toBeCloseTo(50 + RADIUS, 4);
    expect(p.y).toBe(0);
  });

  test('no particle ends a substep inside it', async () => {
    const sim = await createSim(seededScatter(2000, 7));
    const center: [number, number] = [0, 200];
    for (let frame = 0; frame < 10; frame++) {
      sim.step(20, { toolEffect: { ...obstacle, center, radius: 150 } });
    }
    for (const p of await sim.read()) {
      expect(Math.hypot(p.x - center[0], p.y - center[1])).toBeGreaterThanOrEqual(150 + p.radius - 1e-3);
    }
  });
});

describe.skipIf(!device)('tool effects', () => {
  test('give identical particles when a scene is run twice', async () => {
    const run = async () => {
      const sim = await createSim(seededScatter(3000, 3));
      for (let frame = 0; frame < 30; frame++) {
        sim.step(20, {
          toolEffect: { kind: 'vortex', center: [0, 300], radius: 400, strength: 9000 },
          constrainVelocity: [frame % 2 ? 300 : -300, 0]
        });
      }
      return sim.read();
    };
    expect(await run()).toEqual(await run());
  });
});
