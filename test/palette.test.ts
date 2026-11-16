import { describe, expect, test } from 'vitest';

import { randomPalette, Rgb, shade } from '../src/verlet/palette';
import { mulberry32 } from './sim-harness';

describe('a random palette', () => {
  test('is reproducible for a given random source', () => {
    expect(randomPalette(mulberry32(7))).toEqual(randomPalette(mulberry32(7)));
    expect(randomPalette(mulberry32(8))).not.toEqual(randomPalette(mulberry32(7)));
  });

  test('is a colour at full brightness with a fade from 0 to 1', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { rgb, fade } = randomPalette(mulberry32(seed));
      expect(Math.max(...rgb)).toBe(1);
      expect(Math.min(...rgb)).toBeGreaterThanOrEqual(0);
      expect(fade).toBeGreaterThanOrEqual(0);
      expect(fade).toBeLessThanOrEqual(1);
    }
  });
});

describe('a shade', () => {
  const rgb: Rgb = [1, 0.5, 0];

  test('is the colour itself when the palette has no fade', () => {
    expect(shade({ rgb, fade: 0 }, () => 0.9)).toEqual(rgb);
  });

  test('lies between the colour and the fade toward white', () => {
    expect(shade({ rgb, fade: 0.5 }, () => 0)).toEqual(rgb);
    const random = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const [r, g, b] = shade({ rgb, fade: 0.5 }, random);
      expect(r).toBe(1);
      expect(g).toBeGreaterThanOrEqual(0.5);
      expect(g).toBeLessThan(0.75);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(0.5);
      // One mix for every channel, so the hue is kept.
      expect(g - 0.5).toBeCloseTo(b / 2);
    }
  });

  test('varies from one particle to the next', () => {
    const random = mulberry32(3);
    const shades = Array.from({ length: 20 }, () => shade({ rgb, fade: 0.5 }, random).join());
    expect(new Set(shades).size).toBe(20);
  });
});
