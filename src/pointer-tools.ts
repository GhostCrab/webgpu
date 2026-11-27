/**
 * The pointer tools: what the mouse buttons and wheel do. A pure module of
 * the tools, their descriptions and their tuning; the rules that apply them
 * are in SimulationControls.
 */

export type PointerTool = 'force' | 'stir' | 'vortex' | 'shockwave' | 'tilt' | 'container' | 'paddle';

export interface PointerToolInfo {
  id: PointerTool;
  name: string;
  /** What the buttons do, short enough for the settings panel. */
  how: string;
}

/** Every tool, in the order of their number keys, 1 first. */
export const POINTER_TOOLS: readonly PointerToolInfo[] = [
  { id: 'force', name: 'Force', how: 'L pull · R push' },
  { id: 'stir', name: 'Stir', how: 'L drag to stir' },
  { id: 'vortex', name: 'Vortex', how: 'L ↺ · R ↻' },
  { id: 'shockwave', name: 'Shockwave', how: 'L blast · R implode' },
  { id: 'tilt', name: 'Tilt', how: 'L aim · R off · G level' },
  { id: 'container', name: 'Container', how: 'L drag · G recentre' },
  { id: 'paddle', name: 'Paddle', how: 'L push a disc' }
];

/** The tools whose reach the wheel and the Radius setting change, with their starting radius. */
export const TOOL_RADIUS: Partial<Record<PointerTool, number>> = {
  stir: 180,
  vortex: 350,
  paddle: 120
};

/** The range a tool's radius can be set within. */
export const TOOL_RADIUS_RANGE = { min: 20, max: 1000 };

/** Stir: the fraction per second of the way to the pointer's velocity, at its centre. */
export const STIR_RATE = 30;
/** Vortex: acceleration along the swirl at its centre, in units per second squared. */
export const VORTEX_STRENGTH = 9000;
/** Shockwave: how fast a blast's ring grows, in units per second. */
export const BLAST_SPEED = 2400;
/** Shockwave: a blast's acceleration at its ring's middle, in units per second squared. */
export const BLAST_STRENGTH = 90000;
/** Shockwave: an implosion's ring starts this far out and shrinks to its centre. */
export const IMPLOSION_RADIUS = 1400;
/** Shockwave: an implosion's speed and strength, as a fraction of a blast's. */
export const IMPLOSION_SCALE = 0.6;
/** Shockwave: half the ring's thickness. */
export const SHOCKWAVE_WIDTH = 70;
/**
 * Container: the boundary circle can only move within simulation space if it
 * is smaller than its starting radius. Choosing the container shrinks a
 * larger one to this fraction of it.
 */
export const CONTAINER_RADIUS_FRACTION = 0.55;
/**
 * The pointer's velocity is smoothed: each frame keeps this fraction of the
 * last, so one jittery frame does not fling particles.
 */
export const POINTER_VELOCITY_SMOOTHING = 0.5;
