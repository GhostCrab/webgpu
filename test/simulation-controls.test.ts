import { describe, expect, test } from 'vitest';

import { STARTING_BOUNDARY_RADIUS } from '../src/camera';
import { DEFAULT_SUBSTEP_RATE } from '../src/clock';
import {
  BLAST_SPEED,
  BLAST_STRENGTH,
  CONTAINER_RADIUS_FRACTION,
  IMPLOSION_RADIUS,
  IMPLOSION_SCALE,
  POINTER_VELOCITY_SMOOTHING,
  SHOCKWAVE_WIDTH,
  STIR_RATE,
  TOOL_RADIUS,
  TOOL_RADIUS_RANGE,
  VORTEX_STRENGTH
} from '../src/pointer-tools';
import { SimulationControls } from '../src/simulation-controls';
import { DEFAULT_GRAVITY, GRAVITY_STRENGTH } from '../src/verlet/gravity';

const controls = () => new SimulationControls({ constrainRadius: STARTING_BOUNDARY_RADIUS });

/** One 60 Hz frame, in seconds. */
const FRAME = 1 / 60;

describe('click force', () => {
  test('is off, at the origin, until a button is pressed', () => {
    const c = controls();
    c.movePointer(50, 60);
    expect(c.frameInput(FRAME)).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
  });

  test('the attract button pulls toward the pointer', () => {
    const c = controls();
    c.movePointer(50, 60);
    c.pressButton('left');
    expect(c.frameInput(FRAME)).toMatchObject({ clickPoint: [50, 60], clickForce: 2000 });
  });

  test('the repel button pushes away from the pointer', () => {
    const c = controls();
    c.pressButton('right');
    expect(c.frameInput(FRAME).clickForce).toBe(-2000);
  });

  test('follows the pointer while a button is held', () => {
    const c = controls();
    c.pressButton('left');
    c.movePointer(1, 2);
    c.frameInput(FRAME);
    c.movePointer(3, 4);
    expect(c.frameInput(FRAME).clickPoint).toEqual([3, 4]);
  });

  test('stops when the button is released', () => {
    const c = controls();
    c.movePointer(50, 60);
    c.pressButton('left');
    c.frameInput(FRAME);
    c.releaseButton('left');
    expect(c.frameInput(FRAME)).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
  });

  test('with both buttons held, the most recent press wins', () => {
    const c = controls();
    c.pressButton('left');
    c.pressButton('right');
    expect(c.frameInput(FRAME).clickForce).toBe(-2000);
  });

  test('releasing one of two held buttons hands the force to the other', () => {
    const c = controls();
    c.pressButton('left');
    c.pressButton('right');
    c.releaseButton('right');
    expect(c.frameInput(FRAME).clickForce).toBe(2000);

    c.pressButton('right');
    c.releaseButton('left');
    expect(c.frameInput(FRAME).clickForce).toBe(-2000);
  });

  test('uses the impulse set at the time of the press', () => {
    const c = controls();
    c.impulse = 500;
    c.pressButton('left');
    c.impulse = 9000;
    expect(c.frameInput(FRAME).clickForce).toBe(500);
  });
});

describe('click lock', () => {
  test('keeps the force where it was when the button was released', () => {
    const c = controls();
    c.toggle('clickLock');
    c.movePointer(50, 60);
    c.pressButton('right');
    c.frameInput(FRAME);
    c.releaseButton('right');
    c.movePointer(700, 800);
    expect(c.frameInput(FRAME)).toMatchObject({ clickPoint: [50, 60], clickForce: -2000 });
  });

  test('turning it off clears the locked force', () => {
    const c = controls();
    c.toggle('clickLock');
    c.pressButton('left');
    c.frameInput(FRAME);
    c.releaseButton('left');
    c.toggle('clickLock');
    expect(c.frameInput(FRAME).clickForce).toBe(0);
  });
});

describe('settings', () => {
  test('start as collision on, running, reflective constrain', () => {
    expect(controls().frameInput(FRAME)).toMatchObject({
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
    expect(c.frameInput(FRAME).substepRate).toBe(DEFAULT_SUBSTEP_RATE);
    c.substepRate = 1200;
    expect(c.frameInput(FRAME).substepRate).toBe(1200);
  });

  test('start with the accepted collision settings, which the user can change', () => {
    const c = controls();
    expect(c.frameInput(FRAME)).toMatchObject({
      relaxation: 1.25,
      particleRestitution: 0.5,
      particleDamping: 0
    });
    c.relaxation = 1;
    c.particleRestitution = 0.8;
    c.particleDamping = 0.1;
    expect(c.frameInput(FRAME)).toMatchObject({
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
    expect(c.frameInput(FRAME)).toMatchObject({
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
    expect(c.frameInput(FRAME)).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
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
    expect(c.frameInput(FRAME)).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
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

describe('pointer tools', () => {
  test('start with the force tool, and no tool effect, gravity down and the boundary circle at rest', () => {
    const c = controls();
    expect(c.tool).toBe('force');
    c.pressButton('left');
    expect(c.frameInput(FRAME)).toMatchObject({
      clickForce: 2000,
      toolEffect: undefined,
      gravity: DEFAULT_GRAVITY,
      constrainCenter: [0, 0],
      constrainVelocity: [0, 0]
    });
  });

  test('choosing another ends the click force, even under click lock', () => {
    const c = controls();
    c.toggle('clickLock');
    c.pressButton('left');
    c.frameInput(FRAME);
    c.releaseButton('left');
    c.tool = 'stir';
    expect(c.frameInput(FRAME)).toMatchObject({ clickPoint: [0, 0], clickForce: 0 });
  });

  test('other than force, the buttons give no click force', () => {
    const c = controls();
    c.tool = 'vortex';
    c.movePointer(50, 60);
    c.pressButton('left');
    expect(c.frameInput(FRAME).clickForce).toBe(0);
  });
});

describe('stir', () => {
  test('acts only while the left button is held', () => {
    const c = controls();
    c.tool = 'stir';
    expect(c.frameInput(FRAME).toolEffect).toBeUndefined();
    c.pressButton('right');
    expect(c.frameInput(FRAME).toolEffect).toBeUndefined();
  });

  test('takes the pointer, the tool radius and the pointer velocity, smoothed', () => {
    const c = controls();
    c.tool = 'stir';
    c.frameInput(FRAME);
    c.pressButton('left');
    c.movePointer(10, 0);
    const effect = c.frameInput(FRAME).toolEffect;
    expect(effect).toMatchObject({ kind: 'stir', center: [10, 0], radius: TOOL_RADIUS.stir, rate: STIR_RATE });
    // 10 units in a frame, of which smoothing keeps the new part.
    const [vx, vy] = effect.kind === 'stir' ? effect.velocity : [NaN, NaN];
    expect(vx).toBeCloseTo((10 / FRAME) * (1 - POINTER_VELOCITY_SMOOTHING), 6);
    expect(vy).toBe(0);
  });
});

describe('vortex', () => {
  test('spins anticlockwise with the left button and clockwise with the right', () => {
    const c = controls();
    c.tool = 'vortex';
    c.pressButton('left');
    expect(c.frameInput(FRAME).toolEffect).toMatchObject({ kind: 'vortex', strength: -VORTEX_STRENGTH });
    c.releaseButton('left');
    c.pressButton('right');
    expect(c.frameInput(FRAME).toolEffect).toMatchObject({ kind: 'vortex', strength: VORTEX_STRENGTH });
    c.releaseButton('right');
    expect(c.frameInput(FRAME).toolEffect).toBeUndefined();
  });
});

describe('paddle', () => {
  test('is an obstacle at the pointer while the left button is held', () => {
    const c = controls();
    c.tool = 'paddle';
    c.movePointer(5, 6);
    c.frameInput(FRAME);
    c.pressButton('left');
    // Its velocity is the pointer's, as the stir's is.
    expect(c.frameInput(FRAME).toolEffect).toMatchObject({
      kind: 'obstacle',
      center: [5, 6],
      radius: TOOL_RADIUS.paddle
    });
  });
});

describe('shockwave', () => {
  test('a left press blasts a ring outward from the pointer, growing every frame', () => {
    const c = controls();
    c.tool = 'shockwave';
    c.movePointer(100, 200);
    c.pressButton('left');
    c.releaseButton('left');
    c.movePointer(0, 0);
    expect(c.frameInput(FRAME).toolEffect).toEqual({
      kind: 'shockwave',
      center: [100, 200],
      ringRadius: BLAST_SPEED * FRAME,
      width: SHOCKWAVE_WIDTH,
      strength: BLAST_STRENGTH
    });
    const next = c.frameInput(FRAME).toolEffect;
    expect(next.kind === 'shockwave' && next.ringRadius).toBeCloseTo(2 * BLAST_SPEED * FRAME, 9);
  });

  test('a right press implodes: the ring shrinks to the pointer and pushes inward', () => {
    const c = controls();
    c.tool = 'shockwave';
    c.pressButton('right');
    const effect = c.frameInput(FRAME).toolEffect;
    expect(effect).toMatchObject({ kind: 'shockwave', strength: -BLAST_STRENGTH * IMPLOSION_SCALE });
    expect(effect.kind === 'shockwave' && effect.ringRadius).toBeCloseTo(
      IMPLOSION_RADIUS - BLAST_SPEED * IMPLOSION_SCALE * FRAME,
      9
    );
  });

  test('ends: a blast past the starting circle, an implosion at its centre', () => {
    for (const button of ['left', 'right'] as const) {
      const c = controls();
      c.tool = 'shockwave';
      c.pressButton(button);
      let frames = 0;
      while (c.frameInput(FRAME).toolEffect && frames < 1000) frames++;
      expect(frames).toBeLessThan(1000);
      expect(c.toolOutline()).toBeNull();
    }
  });

  test('holds still while paused', () => {
    const c = controls();
    c.tool = 'shockwave';
    c.pressButton('left');
    c.frameInput(FRAME);
    c.toggle('paused');
    const effect = c.frameInput(FRAME).toolEffect;
    expect(effect.kind === 'shockwave' && effect.ringRadius).toBeCloseTo(BLAST_SPEED * FRAME, 9);
  });

  test('is outlined by its ring', () => {
    const c = controls();
    c.tool = 'shockwave';
    c.movePointer(1, 2);
    c.pressButton('left');
    c.frameInput(FRAME);
    expect(c.toolOutline()).toEqual({
      kind: 'circle',
      center: [1, 2],
      radius: BLAST_SPEED * FRAME,
      active: true
    });
  });
});

describe('tilt', () => {
  test('the left button points gravity toward the pointer, and it stays there', () => {
    const c = controls();
    c.tool = 'tilt';
    c.movePointer(-100, 0);
    c.pressButton('left');
    expect(c.frameInput(FRAME).gravity).toEqual([-GRAVITY_STRENGTH, 0]);
    c.releaseButton('left');
    c.movePointer(0, -50);
    expect(c.frameInput(FRAME).gravity).toEqual([-GRAVITY_STRENGTH, 0]);
    expect(c.toolOutline()).toEqual({ kind: 'arrow', from: [0, 0], to: [-GRAVITY_STRENGTH / 10, 0] });
  });

  test('the right button turns gravity off until levelled', () => {
    const c = controls();
    c.tool = 'tilt';
    c.pressButton('right');
    c.frameInput(FRAME);
    c.releaseButton('right');
    expect(c.frameInput(FRAME).gravity).toEqual([0, 0]);
    c.level();
    expect(c.frameInput(FRAME).gravity).toEqual(DEFAULT_GRAVITY);
  });

  test('choosing another tool levels gravity', () => {
    const c = controls();
    c.tool = 'tilt';
    c.pressButton('right');
    c.frameInput(FRAME);
    c.releaseButton('right');
    c.tool = 'force';
    expect(c.frameInput(FRAME).gravity).toEqual(DEFAULT_GRAVITY);
  });
});

describe('container', () => {
  test('choosing it shrinks a boundary circle too large to move, and choosing another restores it', () => {
    const c = controls();
    c.tool = 'container';
    expect(c.constrainRadius).toBe(STARTING_BOUNDARY_RADIUS * CONTAINER_RADIUS_FRACTION);
    c.tool = 'stir';
    expect(c.constrainRadius).toBe(STARTING_BOUNDARY_RADIUS);
  });

  test('leaves a boundary circle already small enough alone', () => {
    const c = controls();
    c.constrainRadius = 300;
    c.tool = 'container';
    expect(c.constrainRadius).toBe(300);
    c.tool = 'force';
    expect(c.constrainRadius).toBe(300);
  });

  test('dragging with the left button moves the boundary circle with the pointer, at its speed', () => {
    const c = controls();
    c.tool = 'container';
    c.movePointer(100, 100);
    c.pressButton('left');
    c.frameInput(FRAME);
    c.movePointer(110, 95);
    const input = c.frameInput(FRAME);
    expect(input.constrainCenter).toEqual([10, -5]);
    expect(input.constrainVelocity[0]).toBeCloseTo(10 / FRAME, 6);
    expect(input.constrainVelocity[1]).toBeCloseTo(-5 / FRAME, 6);
    // Once it stops moving, so does its velocity.
    expect(c.frameInput(FRAME).constrainVelocity).toEqual([0, 0]);
  });

  test('keeps the boundary circle inside the starting circle', () => {
    const c = controls();
    c.tool = 'container';
    c.pressButton('left');
    c.movePointer(5000, 0);
    const room = STARTING_BOUNDARY_RADIUS - c.constrainRadius;
    expect(c.frameInput(FRAME).constrainCenter[0]).toBeCloseTo(room, 6);
  });

  test('stays where it was let go, until levelled, which brings it back without flinging', () => {
    const c = controls();
    c.tool = 'container';
    c.pressButton('left');
    c.movePointer(50, 0);
    c.frameInput(FRAME);
    c.releaseButton('left');
    c.movePointer(0, 0);
    expect(c.frameInput(FRAME).constrainCenter).toEqual([50, 0]);
    c.level();
    expect(c.frameInput(FRAME)).toMatchObject({ constrainCenter: [0, 0], constrainVelocity: [0, 0] });
  });
});

describe('tool radius', () => {
  test('each tool with a reach keeps its own', () => {
    const c = controls();
    c.tool = 'stir';
    c.toolRadius = 250;
    c.tool = 'paddle';
    expect(c.toolRadius).toBe(TOOL_RADIUS.paddle);
    c.tool = 'stir';
    expect(c.toolRadius).toBe(250);
  });

  test('the wheel scales it, within its range', () => {
    const c = controls();
    c.tool = 'vortex';
    c.scaleToolRadius(2);
    expect(c.toolRadius).toBe(TOOL_RADIUS.vortex * 2);
    c.scaleToolRadius(1000);
    expect(c.toolRadius).toBe(TOOL_RADIUS_RANGE.max);
    c.scaleToolRadius(0);
    expect(c.toolRadius).toBe(TOOL_RADIUS_RANGE.min);
  });

  test('a tool without a reach has none to set', () => {
    const c = controls();
    for (const tool of ['force', 'shockwave', 'tilt', 'container'] as const) {
      c.tool = tool;
      expect(c.toolHasRadius).toBe(false);
      c.toolRadius = 300;
      expect(c.toolRadius).toBe(0);
    }
  });

  test('is outlined at the pointer, active while the tool acts', () => {
    const c = controls();
    c.tool = 'paddle';
    c.movePointer(7, 8);
    expect(c.toolOutline()).toEqual({ kind: 'circle', center: [7, 8], radius: TOOL_RADIUS.paddle, active: false });
    c.pressButton('left');
    expect(c.toolOutline()).toMatchObject({ active: true });
  });
});
