/**
 * What the active pointer tool does to the particles in one frame, as
 * simulation input. A pure module: the shapes, and the numbers the shaders
 * know each kind by.
 *
 * Every point is in simulation space and every velocity in simulation units
 * per second. Each effect acts within its own region and leaves the
 * particles outside it alone.
 */
export type ToolEffect =
  | {
      /** Particles within `radius` of `center` take on `velocity`, most strongly near the centre. */
      kind: 'stir';
      center: [number, number];
      radius: number;
      velocity: [number, number];
      /** How fast they take it on: the fraction per second at the centre. */
      rate: number;
    }
  | {
      /** A swirl around `center`, with a pull toward it, within `radius`. */
      kind: 'vortex';
      center: [number, number];
      radius: number;
      /**
       * Acceleration along the swirl at the centre, in units per second
       * squared. Positive spins clockwise as drawn (y points down), negative
       * anticlockwise.
       */
      strength: number;
    }
  | {
      /** A ring of radius `ringRadius` around `center` that accelerates the particles it covers. */
      kind: 'shockwave';
      center: [number, number];
      ringRadius: number;
      /** Half the ring's thickness. */
      width: number;
      /** Acceleration at the ring's middle. Positive pushes outward, negative inward. */
      strength: number;
    }
  | {
      /** A solid disc particles cannot enter, moving at `velocity`. */
      kind: 'obstacle';
      center: [number, number];
      radius: number;
      velocity: [number, number];
    };

/** The number each kind is known by in the shaders (`params.toolKind`); 0 is no effect. */
export const TOOL_EFFECT_KIND: Record<ToolEffect['kind'], number> = {
  stir: 1,
  vortex: 2,
  shockwave: 3,
  obstacle: 4
};
