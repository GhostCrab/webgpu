import { describe, expect, test } from 'vitest';

import { STARTING_BOUNDARY_RADIUS } from '../src/camera';
import { DEFAULT_SUBSTEP_RATE } from '../src/clock';
import { SimulationControls } from '../src/simulation-controls';

const controls = () => new SimulationControls({ constrainRadius: STARTING_BOUNDARY_RADIUS });

describe('click force', () => {
  test('is off, at the origin, until a button is pressed', () => {
    const c = controls();
    c.movePointer(50, 60);
    expect(c.frameInput()).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
  });

  test('the attract button pulls toward the pointer', () => {
    const c = controls();
    c.movePointer(50, 60);
    c.press('attract');
    expect(c.frameInput()).toMatchObject({ clickPoint: [50, 60], clickForce: 2000 });
  });

  test('the repel button pushes away from the pointer', () => {
    const c = controls();
    c.press('repel');
    expect(c.frameInput().clickForce).toBe(-2000);
  });

  test('follows the pointer while a button is held', () => {
    const c = controls();
    c.press('attract');
    c.movePointer(1, 2);
    c.frameInput();
    c.movePointer(3, 4);
    expect(c.frameInput().clickPoint).toEqual([3, 4]);
  });

  test('stops when the button is released', () => {
    const c = controls();
    c.movePointer(50, 60);
    c.press('attract');
    c.frameInput();
    c.release('attract');
    expect(c.frameInput()).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
  });

  test('with both buttons held, the most recent press wins', () => {
    const c = controls();
    c.press('attract');
    c.press('repel');
    expect(c.frameInput().clickForce).toBe(-2000);
  });

  test('releasing one of two held buttons hands the force to the other', () => {
    const c = controls();
    c.press('attract');
    c.press('repel');
    c.release('repel');
    expect(c.frameInput().clickForce).toBe(2000);

    c.press('repel');
    c.release('attract');
    expect(c.frameInput().clickForce).toBe(-2000);
  });

  test('uses the impulse set at the time of the press', () => {
    const c = controls();
    c.impulse = 500;
    c.press('attract');
    c.impulse = 9000;
    expect(c.frameInput().clickForce).toBe(500);
  });
});

describe('click lock', () => {
  test('keeps the force where it was when the button was released', () => {
    const c = controls();
    c.toggle('clickLock');
    c.movePointer(50, 60);
    c.press('repel');
    c.frameInput();
    c.release('repel');
    c.movePointer(700, 800);
    expect(c.frameInput()).toMatchObject({ clickPoint: [50, 60], clickForce: -2000 });
  });

  test('turning it off clears the locked force', () => {
    const c = controls();
    c.toggle('clickLock');
    c.press('attract');
    c.frameInput();
    c.release('attract');
    c.toggle('clickLock');
    expect(c.frameInput().clickForce).toBe(0);
  });
});

describe('settings', () => {
  test('start as collision on, running, reflective constrain', () => {
    expect(controls().frameInput()).toMatchObject({
      collide: true,
      classicConstrain: false,
      constrainRadius: STARTING_BOUNDARY_RADIUS
    });
    expect(controls().paused).toBe(false);
  });

  test('start with a capacity of 50,000 particles', () => {
    expect(controls().capacity).toBe(2000000);
  });

  test('start at the default substep rate, which the user can change', () => {
    const c = controls();
    expect(c.frameInput().substepRate).toBe(DEFAULT_SUBSTEP_RATE);
    c.substepRate = 1200;
    expect(c.frameInput().substepRate).toBe(1200);
  });

  test('start with the accepted collision settings, which the user can change', () => {
    const c = controls();
    expect(c.frameInput()).toMatchObject({
      relaxation: 1.25,
      particleRestitution: 0.5,
      particleDamping: 0
    });
    c.relaxation = 1;
    c.particleRestitution = 0.8;
    c.particleDamping = 0.1;
    expect(c.frameInput()).toMatchObject({
      relaxation: 1,
      particleRestitution: 0.8,
      particleDamping: 0.1
    });
  });

  test('toggles and direct writes both reach the simulation input', () => {
    const c = controls();
    c.toggle('collide');
    c.toggle('classicConstrain');
    c.constrainRadius = 400;
    expect(c.frameInput()).toMatchObject({
      collide: false,
      classicConstrain: true,
      constrainRadius: 400
    });
  });
});

describe('spawn', () => {
  // 600 particles per second, so 10 in a 60 Hz frame.
  const FRAME = 1 / 60;

  test('spawns nothing until the spawn key is held', () => {
    const c = controls();
    c.movePointer(50, 60);
    expect(c.frameSpawn(FRAME)).toEqual([]);
  });

  test('while held, spawns at the spawn rate, at rest near the pointer, with the spawn radius and colour', () => {
    const c = controls();
    c.spawnRate = 600;
    c.spawnRadius = 3;
    c.spawnBaseColor = [1, 0.5, 0];
    c.movePointer(50, 60);
    c.startSpawning();
    const spawned = c.frameSpawn(FRAME);
    expect(spawned).toHaveLength(10);
    for (const p of spawned) {
      expect(Math.hypot(p.x - 50, p.y - 60)).toBeLessThanOrEqual(10 * 3);
      expect(p).toMatchObject({ vx: 0, vy: 0, radius: 3, rgb: [1, 0.5, 0] });
    }
  });

  test('after a seeding, the spawn colour is the seeded palette, and spawned particles are shades of it', () => {
    const c = controls();
    c.useSpawnPalette({ rgb: [1, 0.5, 0], fade: 0.5 });
    expect(c.spawnBaseColor).toEqual([1, 0.5, 0]);
    c.startSpawning();
    const spawned = c.frameSpawn(FRAME);
    expect(new Set(spawned.map((p) => p.rgb.join())).size).toBe(spawned.length);
    for (const { rgb } of spawned) {
      expect(rgb[0]).toBe(1);
      expect(rgb[1]).toBeGreaterThanOrEqual(0.5);
      expect(rgb[1]).toBeLessThan(0.75);
      expect(rgb[2]).toBeLessThan(0.5);
    }
  });

  test('a colour the user picks keeps the seeded variation', () => {
    const c = controls();
    c.useSpawnPalette({ rgb: [1, 0.5, 0], fade: 0.5 });
    c.spawnBaseColor = [0, 0, 1];
    c.startSpawning();
    const spawned = c.frameSpawn(FRAME);
    expect(new Set(spawned.map((p) => p.rgb.join())).size).toBe(spawned.length);
    for (const { rgb } of spawned) {
      expect(rgb[2]).toBe(1);
      expect(rgb[0]).toBeLessThan(0.5);
      expect(rgb[0]).toBe(rgb[1]);
    }
  });

  test('spreads the particles it spawns', () => {
    const c = controls();
    c.startSpawning();
    const spawned = c.frameSpawn(FRAME);
    expect(new Set(spawned.map((p) => `${p.x},${p.y}`)).size).toBe(spawned.length);
  });

  test('carries part of a particle between frames, so a second of 144 Hz frames spawns the rate', () => {
    const c = controls();
    c.spawnRate = 100;
    c.startSpawning();
    let total = 0;
    for (let frame = 0; frame < 144; frame++) total += c.frameSpawn(1 / 144).length;
    expect(total).toBe(100);
  });

  test('a stalled frame spawns no more than a 60 Hz frame does', () => {
    const c = controls();
    c.spawnRate = 600;
    c.startSpawning();
    expect(c.frameSpawn(2)).toHaveLength(10);
  });

  test('stops when the spawn key is released', () => {
    const c = controls();
    c.startSpawning();
    c.frameSpawn(FRAME);
    c.stopSpawning();
    expect(c.frameSpawn(FRAME)).toEqual([]);
  });

  test('spawns nothing while paused', () => {
    const c = controls();
    c.startSpawning();
    c.toggle('paused');
    expect(c.frameSpawn(FRAME)).toEqual([]);
  });

  test('leaves the click force alone', () => {
    const c = controls();
    c.movePointer(50, 60);
    c.startSpawning();
    c.frameSpawn(FRAME);
    expect(c.frameInput()).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
  });
});

describe('erase', () => {
  test('erases nothing until the erase key is held', () => {
    const c = controls();
    c.movePointer(50, 60);
    expect(c.frameErase()).toBeNull();
  });

  test('while held, erases within the erase radius of the pointer, every frame', () => {
    const c = controls();
    c.eraseRadius = 25;
    c.movePointer(50, 60);
    c.startErasing();
    expect(c.frameErase()).toEqual({ center: [50, 60], radius: 25 });
    c.movePointer(70, 80);
    expect(c.frameErase()).toEqual({ center: [70, 80], radius: 25 });
  });

  test('stops when the erase key is released', () => {
    const c = controls();
    c.startErasing();
    c.stopErasing();
    expect(c.frameErase()).toBeNull();
  });

  test('erases nothing while paused', () => {
    const c = controls();
    c.startErasing();
    c.toggle('paused');
    expect(c.frameErase()).toBeNull();
  });

  test('leaves the click force and spawning alone', () => {
    const c = controls();
    c.movePointer(50, 60);
    c.startErasing();
    c.frameErase();
    expect(c.frameInput()).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
    expect(c.frameSpawn(1 / 60)).toEqual([]);
  });
});

describe('constrain radius range', () => {
  test('reaches the starting radius, which is its maximum', () => {
    const c = controls();
    expect(c.constrainRadiusRange.max).toBe(STARTING_BOUNDARY_RADIUS);
    expect(c.constrainRadius).toBeLessThanOrEqual(c.constrainRadiusRange.max);
    expect(c.constrainRadius).toBeGreaterThanOrEqual(c.constrainRadiusRange.min);
  });

  test('keeps the starting radius as its maximum after the radius is lowered', () => {
    const c = controls();
    c.constrainRadius = 400;
    expect(c.constrainRadiusRange.max).toBe(STARTING_BOUNDARY_RADIUS);
  });
});
