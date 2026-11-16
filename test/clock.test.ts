import { describe, expect, test } from 'vitest';

import { Clock, frameRate } from '../src/clock';

describe('the clock', () => {
  test('turns elapsed time into substeps at the substep rate', () => {
    expect(new Clock().advance(1 / 60, 1200).substeps).toBe(20);
    expect(new Clock().advance(0.01, 1200).substeps).toBe(12);
  });

  test('carries the time left over from one frame into the next', () => {
    const clock = new Clock();
    // 2.5 substeps' worth each frame: 2, then 3 with the carried half.
    expect(clock.advance(2.5 / 1200, 1200).substeps).toBe(2);
    expect(clock.advance(2.5 / 1200, 1200).substeps).toBe(3);
    expect(clock.advance(2.5 / 1200, 1200).substeps).toBe(2);
  });

  test('a frame shorter than a substep runs none, and its time is not lost', () => {
    const clock = new Clock();
    expect(clock.advance(0.4 / 1200, 1200).substeps).toBe(0);
    expect(clock.advance(0.4 / 1200, 1200).substeps).toBe(0);
    expect(clock.advance(0.4 / 1200, 1200).substeps).toBe(1);
  });

  test('a long pause is followed by at most 1/60 s of simulated time', () => {
    const clock = new Clock();
    expect(clock.advance(5, 1200).substeps).toBe(20);
    // The pause is not paid back afterwards: the simulation fell behind.
    expect(clock.advance(1 / 60, 1200).substeps).toBe(20);
  });

  test('a slow frame still reports the substeps it wanted', () => {
    expect(new Clock().advance(0.05, 1200)).toEqual({ substeps: 20, wanted: 60 });
  });

  test.each([60, 144, 75, 30])('one second of %i Hz frames runs one second of substeps', (hz) => {
    const clock = new Clock();
    let total = 0;
    for (let frame = 0; frame < hz; frame++) {
      const tick = clock.advance(1 / hz, 1200);
      expect(tick.substeps).toBeLessThanOrEqual(20);
      total += tick.substeps;
    }
    // 30 Hz frames are each longer than the 1/60 s limit, so half is dropped.
    expect(total).toBe(hz >= 60 ? 1200 : 600);
  });

  test('a substep rate that is not a multiple of 60 keeps real time at 60 Hz', () => {
    const clock = new Clock();
    let total = 0;
    for (let frame = 0; frame < 60; frame++) total += clock.advance(1 / 60, 1000).substeps;
    expect(total).toBe(1000);
  });

  test('a negative or non-finite elapsed time runs nothing and does not poison the clock', () => {
    const clock = new Clock();
    expect(clock.advance(-1, 1200).substeps).toBe(0);
    expect(clock.advance(NaN, 1200).substeps).toBe(0);
    expect(clock.advance(1 / 60, 1200).substeps).toBe(20);
  });

  test.each([0, -1200, NaN])('rejects a substep rate of %s', (rate) => {
    expect(() => new Clock().advance(1 / 60, rate)).toThrow('substep rate must be a positive number');
  });
});

describe('the frame rate', () => {
  test('is one over the time between frames', () => {
    expect(frameRate(1 / 60)).toBeCloseTo(60, 9);
    expect(frameRate(0.5)).toBe(2);
  });

  test('is unknown when two frames share a timestamp, or time runs backwards', () => {
    expect(frameRate(0)).toBeNull();
    expect(frameRate(-0.01)).toBeNull();
    expect(frameRate(NaN)).toBeNull();
  });
});
