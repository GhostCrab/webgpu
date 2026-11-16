/**
 * Particle colours: a palette, and the shades of it particles are given. A pure
 * module, so the simulation controls can use it without loading the simulation.
 */

/** A colour, each channel 0 to 1. */
export type Rgb = [number, number, number];

/** The colour a group of particles share, and how far their shades of it vary. */
export interface Palette {
  /** The colour itself: the strongest shade. */
  rgb: Rgb;
  /** The furthest a shade is mixed toward white, 0 (not at all) to 1 (white). */
  fade: number;
}

function HSVtoRGB(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/**
 * A palette of one random hue at full brightness, whose shades span a random
 * range of saturation. `random` is a source of numbers in [0, 1); defaults to
 * Math.random.
 */
export function randomPalette(random: () => number = Math.random): Palette {
  const hue = random();
  const a = random();
  const b = random();
  const weakest = Math.min(a, b);
  const strongest = Math.max(a, b);
  return {
    rgb: HSVtoRGB(hue, strongest, 1),
    // Mixing toward white lowers saturation in proportion.
    fade: strongest > 0 ? 1 - weakest / strongest : 0
  };
}

/** One particle's colour: the palette's, mixed a random part of its fade toward white. */
export function shade(palette: Palette, random: () => number = Math.random): Rgb {
  const mix = palette.fade * random();
  const [r, g, b] = palette.rgb;
  return [r + mix * (1 - r), g + mix * (1 - g), b + mix * (1 - b)];
}
