import { describe, expect, test } from 'vitest';

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
