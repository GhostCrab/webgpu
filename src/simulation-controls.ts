import { DEFAULT_SUBSTEP_RATE, MAX_FRAME_TIME } from './clock';
import { DEFAULT_CAPACITY, SEED_RADIUS } from './verlet/capacity';
import { DEFAULT_COLLISION_SETTINGS } from './verlet/collision';
import { Palette, Rgb, shade } from './verlet/palette';
import type { SeedParticle } from './verlet/particle-layout';
import type { EraseRegion, SimulationInput } from './verlet/verlet';

/** Spawned particles land within this many spawn radii of the pointer. */
const SPAWN_SPREAD = 10;

/** The smallest constrain radius the settings panel offers. */
const MIN_CONSTRAIN_RADIUS = 50;

/** Which way a held mouse button drives the click force. */
export type ClickButton = 'attract' | 'repel';

/**
 * The simulation controls: the user-adjustable state of the simulation, and
 * the rules that turn pointer and button actions into simulation input.
 *
 * Knows nothing about the DOM or the GPU. The keyboard and mouse bindings and
 * the settings panel both drive this one object.
 *
 * Spawning is its own gesture, separate from the click force: while the spawn
 * key is held, particles are spawned around the pointer at the spawn rate.
 * Erasing is another: while the erase key is held, the particles within the
 * erase radius of the pointer are erased, every frame.
 */
export class SimulationControls {
  // Settings. The settings panel reads and writes these directly.
  collide = true;
  paused = false;
  /** Keeps the click force active after the button is released. */
  clickLock = false;
  classicConstrain = false;
  constrainRadius: number;
  /**
   * The range the constrain radius can be set within. Its maximum is the
   * starting radius: simulation space and the bin grid are sized from that
   * radius once, so a larger boundary circle would reach past them.
   */
  readonly constrainRadiusRange: { min: number; max: number };
  /** Strength a click force takes when a button is pressed. */
  impulse = 2000;
  /** Substeps per second of simulated time: the simulation's accuracy. */
  substepRate = DEFAULT_SUBSTEP_RATE;
  /** Scales each particle's averaged collision correction. */
  relaxation = DEFAULT_COLLISION_SETTINGS.relaxation;
  /** Fraction of relative normal speed kept when two particles collide. */
  particleRestitution = DEFAULT_COLLISION_SETTINGS.particleRestitution;
  /** Fraction of relative speed along the contact lost when two particles collide. */
  particleDamping = DEFAULT_COLLISION_SETTINGS.particleDamping;
  /**
   * The most particles the simulation holds. A startup setting: the
   * simulation is restarted to change it.
   */
  capacity = DEFAULT_CAPACITY;
  /** Particles spawned per second while the spawn key is held. */
  spawnRate = 600;
  /** Radius of each spawned particle. */
  spawnRadius = SEED_RADIUS;
  /**
   * The colour spawned particles are shades of, each channel 0 to 1. Starts,
   * and restarts at every seeding, as the seeded particles' colour.
   */
  spawnBaseColor: Rgb = [1, 1, 1];
  /** The furthest a spawned particle's shade is mixed toward white, 0 to 1. */
  spawnFade = 0;
  /** Particles within this distance of the pointer are erased while the erase key is held. */
  eraseRadius = 30;

  private pointer: [number, number] = [0, 0];
  private held: Record<ClickButton, boolean> = { attract: false, repel: false };
  private heldForce = 0;
  private clickPoint: [number, number] = [0, 0];
  private clickForce = 0;
  private spawning = false;
  private erasing = false;
  /** Part of a particle owed to the next frame's spawn. */
  private spawnOwed = 0;
  private random: () => number;

  /** `random`, a source of numbers in [0, 1), spreads spawned particles. Defaults to Math.random. */
  constructor(options: { constrainRadius: number; random?: () => number }) {
    this.constrainRadius = options.constrainRadius;
    this.constrainRadiusRange = {
      min: Math.min(MIN_CONSTRAIN_RADIUS, options.constrainRadius),
      max: options.constrainRadius
    };
    this.random = options.random ?? Math.random;
  }

  /** Spawned particles take shades of this palette: the one just seeded. */
  useSpawnPalette(palette: Palette) {
    this.spawnBaseColor = [...palette.rgb];
    this.spawnFade = palette.fade;
  }

  /** The spawn key is pressed. */
  startSpawning() {
    this.spawning = true;
  }

  /** The spawn key is released. */
  stopSpawning() {
    this.spawning = false;
    this.spawnOwed = 0;
  }

  /**
   * The particles to spawn this frame, `elapsed` seconds after the last: while
   * the spawn key is held and the simulation runs, the spawn rate's worth,
   * at rest and spread around the pointer, each a shade of the spawn colour. Part of a particle is carried into
   * the next frame, and like the clock a frame counts at most 1/60 s.
   */
  frameSpawn(elapsed: number): SeedParticle[] {
    if (!this.spawning || this.paused) return [];
    this.spawnOwed += this.spawnRate * Math.min(Math.max(elapsed, 0), MAX_FRAME_TIME);
    // Rates and frame intervals are not exact in binary; a hair short counts.
    const count = Math.floor(this.spawnOwed + 1e-6);
    this.spawnOwed = Math.max(this.spawnOwed - count, 0);

    const spread = SPAWN_SPREAD * this.spawnRadius;
    const particles: SeedParticle[] = [];
    for (let i = 0; i < count; i++) {
      // Uniform over the disc of radius `spread` around the pointer.
      const distance = spread * Math.sqrt(this.random());
      const angle = 2 * Math.PI * this.random();
      particles.push({
        x: this.pointer[0] + distance * Math.cos(angle),
        y: this.pointer[1] + distance * Math.sin(angle),
        vx: 0,
        vy: 0,
        radius: this.spawnRadius,
        rgb: shade({ rgb: this.spawnBaseColor, fade: this.spawnFade }, this.random)
      });
    }
    return particles;
  }

  /** The erase key is pressed. */
  startErasing() {
    this.erasing = true;
  }

  /** The erase key is released. */
  stopErasing() {
    this.erasing = false;
  }

  /**
   * What to erase this frame: while the erase key is held and the simulation
   * runs, the particles within the erase radius of the pointer; otherwise
   * nothing.
   */
  frameErase(): EraseRegion | null {
    if (!this.erasing || this.paused) return null;
    return { center: [...this.pointer], radius: this.eraseRadius };
  }

  /** The pointer's position in simulation space. */
  movePointer(x: number, y: number) {
    this.pointer = [x, y];
  }

  /** The most recently pressed button decides the direction of the force. */
  press(button: ClickButton) {
    this.held[button] = true;
    this.heldForce = button === 'attract' ? this.impulse : -this.impulse;
  }

  /** Releasing one button hands the force to the other if it is still held. */
  release(button: ClickButton) {
    this.held[button] = false;
    if (button === 'attract') {
      this.heldForce = this.held.repel ? -this.impulse : 0;
    } else {
      this.heldForce = this.held.attract ? this.impulse : 0;
    }
  }

  toggle(setting: 'collide' | 'paused' | 'clickLock' | 'classicConstrain') {
    this[setting] = !this[setting];
  }

  /**
   * The simulation input for the next frame. Call once per frame: while a
   * button is held the click force follows the pointer, and with click lock
   * on it stays where it was when the button was released.
   */
  frameInput(): SimulationInput {
    if (this.held.attract || this.held.repel) {
      this.clickPoint = this.pointer;
      this.clickForce = this.heldForce;
    } else if (!this.clickLock) {
      this.clickPoint = [0, 0];
      this.clickForce = 0;
    }

    return {
      clickPoint: this.clickPoint,
      clickForce: this.clickForce,
      constrainRadius: this.constrainRadius,
      classicConstrain: this.classicConstrain,
      collide: this.collide,
      substepRate: this.substepRate,
      relaxation: this.relaxation,
      particleRestitution: this.particleRestitution,
      particleDamping: this.particleDamping
    };
  }
}
