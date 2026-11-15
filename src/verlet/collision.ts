/**
 * The new pipeline's collision settings and their defaults. A pure module, so
 * the simulation controls can use the defaults without loading the simulation.
 */

/**
 * The factor each particle's averaged collision correction is scaled by.
 * 1.25 was the only factor the prototype (#14) found stable at every substep
 * rate it measured.
 */
export const DEFAULT_RELAXATION = 1.25;

/** Fraction of the relative normal speed two particles keep when they collide. */
export const DEFAULT_PARTICLE_RESTITUTION = 0.5;

/** Fraction of the relative speed along the contact two particles lose when they collide. */
export const DEFAULT_PARTICLE_DAMPING = 0;

/** How particles collide with each other. The boundary circle has its own rules. */
export interface CollisionSettings {
  /** Scales each particle's averaged collision correction. */
  relaxation: number;
  /** Fraction of the relative normal speed two particles keep when they collide, 0 to 1. */
  particleRestitution: number;
  /** Fraction of the relative speed along the contact lost when they collide, 0 to 1. */
  particleDamping: number;
}

export const DEFAULT_COLLISION_SETTINGS: CollisionSettings = {
  relaxation: DEFAULT_RELAXATION,
  particleRestitution: DEFAULT_PARTICLE_RESTITUTION,
  particleDamping: DEFAULT_PARTICLE_DAMPING
};
