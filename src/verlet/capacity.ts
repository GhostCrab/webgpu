/**
 * The limits on what the simulation holds, and the radius of its default
 * particles. A pure module, so the simulation controls can use them without
 * loading the simulation.
 */

/** The most particles a simulation holds at once unless it is told otherwise. */
export const DEFAULT_CAPACITY = 50000;

/**
 * The most the largest radius in use may be, as a multiple of the smallest. It
 * bounds how many particles a bin sized for the largest can hold.
 */
export const MAX_RADIUS_RATIO = 4;

/** The most particles the default seed scatters; fewer if the capacity is less. */
export const SEED_COUNT = 15000;

/**
 * The radius the default seed gives every particle, the starting spawn radius,
 * and so the smallest radius the settings panel offers to spawn.
 */
export const SEED_RADIUS = 1.5;
