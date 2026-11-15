/**
 * The limits on what the simulation holds. A pure module, so the simulation
 * controls can use them without loading the simulation.
 */

/** The most particles a simulation holds at once unless it is told otherwise. */
export const DEFAULT_CAPACITY = 50000;

/**
 * The most the largest radius in use may be, as a multiple of the smallest. It
 * bounds how many particles a bin sized for the largest can hold.
 */
export const MAX_RADIUS_RATIO = 4;
