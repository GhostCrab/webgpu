import { describe, expect, test } from 'vitest';

import { canvasToSimulation, fitViewport } from '../src/letterbox';
import { SimulationControls } from '../src/simulation-controls';

const controls = () => new SimulationControls({ constrainRadius: 1060 });

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
      constrainRadius: 1060
    });
    expect(controls().paused).toBe(false);
  });

  test('start with a capacity of 50,000 particles', () => {
    expect(controls().capacity).toBe(50000);
  });

  test('start at 2400 substeps per second, which the user can change', () => {
    const c = controls();
    expect(c.frameInput().substepRate).toBe(2400);
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
    c.spawnColor = [1, 0.5, 0];
    c.movePointer(50, 60);
    c.startSpawning();
    const spawned = c.frameSpawn(FRAME);
    expect(spawned).toHaveLength(10);
    for (const p of spawned) {
      expect(Math.hypot(p.x - 50, p.y - 60)).toBeLessThanOrEqual(10 * 3);
      expect(p).toMatchObject({ vx: 0, vy: 0, radius: 3, rgb: [1, 0.5, 0] });
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

describe('fitting simulation space to the canvas', () => {
  test('a wider canvas gets bars at the sides', () => {
    expect(fitViewport(3840, 2160, 2000, 900)).toEqual({ x: 200, y: 0, width: 1600, height: 900 });
  });

  test('a taller canvas gets bars at top and bottom', () => {
    expect(fitViewport(3840, 2160, 1600, 1300)).toEqual({ x: 0, y: 200, width: 1600, height: 900 });
  });

  test('a canvas of the same shape is filled', () => {
    expect(fitViewport(3840, 2160, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe('mapping the pointer into simulation space', () => {
  const viewport = fitViewport(3840, 2160, 2000, 900);
  const map = (x: number, y: number) => canvasToSimulation(viewport, 3840, 2160, x, y);

  test('the centre of the canvas is the origin', () => {
    expect(map(1000, 450)).toEqual([0, 0]);
  });

  test('the viewport corners are the corners of simulation space', () => {
    expect(map(200, 0)).toEqual([-1920, -1080]);
    expect(map(1800, 900)).toEqual([1920, 1080]);
  });

  test('a collapsed canvas maps every point to the origin', () => {
    const collapsed = fitViewport(3840, 2160, 800, 0);
    expect(canvasToSimulation(collapsed, 3840, 2160, 400, 0)).toEqual([0, 0]);
    expect(canvasToSimulation(fitViewport(3840, 2160, 0, 0), 3840, 2160, 0, 0)).toEqual([0, 0]);
  });

  test('points in the bars clamp to the edge', () => {
    expect(map(0, 450)).toEqual([-1920, 0]);
    expect(map(2000, 450)).toEqual([1920, 0]);
  });
});
