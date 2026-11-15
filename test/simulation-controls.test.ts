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
