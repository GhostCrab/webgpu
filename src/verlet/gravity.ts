/**
 * Gravity, in simulation units per second squared along +y (down, as drawn):
 * the same for every particle, whatever its radius. A pure module.
 */
export const GRAVITY_STRENGTH = 3000;

/** The gravity the simulation runs under unless its input gives another. */
export const DEFAULT_GRAVITY: [number, number] = [0, GRAVITY_STRENGTH];
