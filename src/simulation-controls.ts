import { DEFAULT_SUBSTEP_RATE, MAX_FRAME_TIME } from './clock';
import {
  BLAST_SPEED,
  BLAST_STRENGTH,
  CONTAINER_RADIUS_FRACTION,
  IMPLOSION_RADIUS,
  IMPLOSION_SCALE,
  POINTER_VELOCITY_SMOOTHING,
  PointerTool,
  SHOCKWAVE_WIDTH,
  STIR_RATE,
  TOOL_RADIUS,
  TOOL_RADIUS_RANGE,
  VORTEX_STRENGTH
} from './pointer-tools';
import { DEFAULT_CAPACITY, SEED_RADIUS } from './verlet/capacity';
import { DEFAULT_COLLISION_SETTINGS } from './verlet/collision';
import { DEFAULT_GRAVITY, GRAVITY_STRENGTH } from './verlet/gravity';
import { Palette, Rgb, shade } from './verlet/palette';
import type { SeedParticle } from './verlet/particle-layout';
import type { ToolEffect } from './verlet/tool-effect';
import type { EraseRegion, SimulationInput } from './verlet/verlet';

/** Spawned particles land within this many spawn radii of the pointer. */
const SPAWN_SPREAD = 10;

/** The smallest constrain radius the settings panel offers. */
const MIN_CONSTRAIN_RADIUS = 50;

/** A mouse button. What it does depends on the pointer tool. */
export type MouseButton = 'left' | 'right';

/** The shortest frame the pointer's velocity is measured over, in seconds. */
const MIN_POINTER_FRAME = 1 / 240;

/** What to outline over the simulation to show the pointer tool. */
export type ToolOutline =
  | { kind: 'circle'; center: [number, number]; radius: number; active: boolean }
  /** Tilt's gravity, drawn from the origin at a tenth of its size in units. */
  | { kind: 'arrow'; from: [number, number]; to: [number, number] };

/** A shockwave under way: where it started, how long ago, and which way it goes. */
interface Shockwave {
  origin: [number, number];
  age: number;
  implode: boolean;
}

/**
 * The simulation controls: the user-adjustable state of the simulation, and
 * the rules that turn pointer and button actions into simulation input.
 *
 * Knows nothing about the DOM or the GPU. The keyboard and mouse bindings and
 * the settings panel both drive this one object.
 *
 * The pointer tool decides what the mouse buttons and wheel do: the click
 * force (the force tool), or one of the others in `pointer-tools.ts`, which
 * act through gravity, the boundary circle and the tool effect.
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
  spawnRate = 20000;
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
  private held: Record<MouseButton, boolean> = { left: false, right: false };
  private activeTool: PointerTool = 'force';
  private toolRadii: Partial<Record<PointerTool, number>> = { ...TOOL_RADIUS };
  /** Where the pointer was at the last frame, and its smoothed velocity since. */
  private framePointer: [number, number] = [0, 0];
  private pointerVelocity: [number, number] = [0, 0];
  /** Gravity, which tilt turns. */
  private gravity: [number, number] = [...DEFAULT_GRAVITY];
  /** The boundary circle's centre, which the container moves, and where it was at the last frame. */
  private boundaryCenter: [number, number] = [0, 0];
  private frameBoundaryCenter: [number, number] = [0, 0];
  /** Where the container was grabbed, from its centre. */
  private grabOffset: [number, number] = [0, 0];
  private shockwave: Shockwave | null = null;
  private shockwaveRing = 0;
  /** The constrain radius the container shrank, to restore when another tool is chosen. */
  private radiusBeforeContainer: number | null = null;
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

  /**
   * The pointer tool: what the mouse buttons and wheel do. Choosing one starts
   * it afresh: gravity points down again, the boundary circle is back at the
   * origin, and no shockwave is under way. Choosing the container shrinks a
   * boundary circle too large to move; choosing another tool restores it.
   */
  get tool(): PointerTool {
    return this.activeTool;
  }

  set tool(tool: PointerTool) {
    if (tool === this.activeTool) return;
    if (this.radiusBeforeContainer !== null) {
      this.constrainRadius = this.radiusBeforeContainer;
      this.radiusBeforeContainer = null;
    }
    this.activeTool = tool;
    this.heldForce = 0;
    this.clickForce = 0;
    this.clickPoint = [0, 0];
    this.shockwave = null;
    this.level();
    if (tool === 'container') {
      const largest = this.constrainRadiusRange.max * CONTAINER_RADIUS_FRACTION;
      if (this.constrainRadius > largest) {
        this.radiusBeforeContainer = this.constrainRadius;
        this.constrainRadius = largest;
      }
    }
  }

  /** Whether the tool has a reach that the wheel and the Radius setting change. */
  get toolHasRadius(): boolean {
    return this.toolRadii[this.activeTool] !== undefined;
  }

  /** The tool's reach, in simulation units. Each tool keeps its own; 0 for a tool with none. */
  get toolRadius(): number {
    return this.toolRadii[this.activeTool] ?? 0;
  }

  set toolRadius(radius: number) {
    if (!this.toolHasRadius) return;
    this.toolRadii[this.activeTool] = Math.min(
      Math.max(radius, TOOL_RADIUS_RANGE.min),
      TOOL_RADIUS_RANGE.max
    );
  }

  /** The wheel: scales the tool's reach, within its range. */
  scaleToolRadius(factor: number) {
    this.toolRadius = this.toolRadius * factor;
  }

  /** Gravity points down again and the boundary circle returns to the origin. */
  level() {
    this.gravity = [...DEFAULT_GRAVITY];
    this.boundaryCenter = [0, 0];
    this.frameBoundaryCenter = [0, 0];
  }

  /**
   * A mouse button is pressed. With the force tool, the most recently pressed
   * button decides the direction of the force; with the shockwave, each press
   * starts one at the pointer, replacing any under way; with the container, a
   * left press grabs the boundary circle where the pointer is.
   */
  pressButton(button: MouseButton) {
    this.held[button] = true;
    switch (this.activeTool) {
      case 'force':
        this.heldForce = button === 'left' ? this.impulse : -this.impulse;
        break;
      case 'shockwave':
        this.shockwave = { origin: [...this.pointer], age: 0, implode: button === 'right' };
        this.shockwaveRing = button === 'right' ? IMPLOSION_RADIUS : 0;
        break;
      case 'container':
        if (button === 'left') {
          this.grabOffset = [
            this.pointer[0] - this.boundaryCenter[0],
            this.pointer[1] - this.boundaryCenter[1]
          ];
        }
        break;
    }
  }

  /**
   * A mouse button is released. With the force tool, the force passes to the
   * other button if it is still held.
   */
  releaseButton(button: MouseButton) {
    this.held[button] = false;
    if (this.activeTool !== 'force') return;
    if (button === 'left') {
      this.heldForce = this.held.right ? -this.impulse : 0;
    } else {
      this.heldForce = this.held.left ? this.impulse : 0;
    }
  }

  /**
   * What to outline to show the tool, as of the last frame: the reach of a
   * stir, vortex or paddle (active while it acts), a shockwave's ring, tilt's
   * gravity, the container's boundary circle. Null for the force tool, and
   * for a shockwave when none is under way.
   */
  toolOutline(): ToolOutline | null {
    const pointer: [number, number] = [...this.pointer];
    switch (this.activeTool) {
      case 'force':
        return null;
      case 'stir':
      case 'paddle':
        return { kind: 'circle', center: pointer, radius: this.toolRadius, active: this.held.left };
      case 'vortex':
        return {
          kind: 'circle',
          center: pointer,
          radius: this.toolRadius,
          active: this.held.left || this.held.right
        };
      case 'shockwave':
        if (!this.shockwave) return null;
        return {
          kind: 'circle',
          center: [...this.shockwave.origin],
          radius: this.shockwaveRing,
          active: true
        };
      case 'tilt':
        return { kind: 'arrow', from: [0, 0], to: [this.gravity[0] / 10, this.gravity[1] / 10] };
      case 'container':
        return {
          kind: 'circle',
          center: [...this.boundaryCenter],
          radius: this.constrainRadius,
          active: this.held.left
        };
    }
  }

  /** The pointer's velocity over the frame, smoothed. */
  private trackPointer(elapsed: number) {
    const frame = Math.max(elapsed, MIN_POINTER_FRAME);
    const keep = POINTER_VELOCITY_SMOOTHING;
    const moved = (axis: 0 | 1) =>
      this.pointerVelocity[axis] * keep +
      ((this.pointer[axis] - this.framePointer[axis]) / frame) * (1 - keep);
    this.pointerVelocity = [moved(0), moved(1)];
    this.framePointer = [...this.pointer];
  }

  /**
   * Tilt: the left button points gravity from the origin toward the pointer,
   * and the right turns it off. Either lasts until changed or levelled.
   */
  private frameGravity(): [number, number] {
    if (this.activeTool === 'tilt') {
      if (this.held.right) {
        this.gravity = [0, 0];
      } else if (this.held.left) {
        const length = Math.hypot(this.pointer[0], this.pointer[1]);
        if (length > 0) {
          this.gravity = [
            (this.pointer[0] / length) * GRAVITY_STRENGTH,
            (this.pointer[1] / length) * GRAVITY_STRENGTH
          ];
        }
      }
    }
    return [...this.gravity];
  }

  /**
   * The container: while the left button is held the boundary circle follows
   * the pointer, kept within the starting circle so it stays inside
   * simulation space. Its velocity is how far it moved over the frame.
   */
  private frameBoundary(elapsed: number): { center: [number, number]; velocity: [number, number] } {
    if (this.activeTool === 'container' && this.held.left) {
      const room = Math.max(this.constrainRadiusRange.max - this.constrainRadius, 0);
      let x = this.pointer[0] - this.grabOffset[0];
      let y = this.pointer[1] - this.grabOffset[1];
      const distance = Math.hypot(x, y);
      if (distance > room) {
        const scale = room / distance;
        x *= scale;
        y *= scale;
      }
      this.boundaryCenter = [x, y];
    }
    const frame = Math.max(elapsed, MIN_POINTER_FRAME);
    const velocity: [number, number] = [
      (this.boundaryCenter[0] - this.frameBoundaryCenter[0]) / frame,
      (this.boundaryCenter[1] - this.frameBoundaryCenter[1]) / frame
    ];
    this.frameBoundaryCenter = [...this.boundaryCenter];
    return { center: [...this.boundaryCenter], velocity };
  }

  /** The stir, vortex, shockwave or paddle, while it acts. */
  private frameToolEffect(elapsed: number): ToolEffect | undefined {
    const center: [number, number] = [...this.pointer];
    const radius = this.toolRadius;
    switch (this.activeTool) {
      case 'stir':
        if (!this.held.left) return undefined;
        return { kind: 'stir', center, radius, velocity: [...this.pointerVelocity], rate: STIR_RATE };
      case 'vortex':
        if (this.held.left) return { kind: 'vortex', center, radius, strength: -VORTEX_STRENGTH };
        if (this.held.right) return { kind: 'vortex', center, radius, strength: VORTEX_STRENGTH };
        return undefined;
      case 'paddle':
        if (!this.held.left) return undefined;
        return { kind: 'obstacle', center, radius, velocity: [...this.pointerVelocity] };
      case 'shockwave':
        return this.frameShockwave(elapsed);
      default:
        return undefined;
    }
  }

  /**
   * A shockwave's ring grows from where it started (a blast) or shrinks to it
   * (an implosion), and holds still while the simulation is paused. A blast
   * ends once its ring could have crossed the starting circle, an implosion
   * when its ring reaches its centre.
   */
  private frameShockwave(elapsed: number): ToolEffect | undefined {
    const wave = this.shockwave;
    if (!wave) return undefined;
    if (!this.paused) wave.age += Math.min(Math.max(elapsed, 0), MAX_FRAME_TIME);
    const ring = wave.implode
      ? IMPLOSION_RADIUS - BLAST_SPEED * IMPLOSION_SCALE * wave.age
      : BLAST_SPEED * wave.age;
    if (ring < 0 || ring > 2 * this.constrainRadiusRange.max) {
      this.shockwave = null;
      return undefined;
    }
    this.shockwaveRing = ring;
    return {
      kind: 'shockwave',
      center: [...wave.origin],
      ringRadius: ring,
      width: SHOCKWAVE_WIDTH,
      strength: wave.implode ? -BLAST_STRENGTH * IMPLOSION_SCALE : BLAST_STRENGTH
    };
  }

  toggle(setting: 'collide' | 'paused' | 'clickLock' | 'classicConstrain') {
    this[setting] = !this[setting];
  }

  /**
   * The simulation input for the next frame, `elapsed` seconds after the last.
   * Call once per frame. With the force tool, while a button is held the
   * click force follows the pointer, and with click lock on it stays where it
   * was when the button was released. The other tools act through gravity,
   * the boundary circle and the tool effect.
   */
  frameInput(elapsed: number): SimulationInput {
    this.trackPointer(elapsed);

    if (this.activeTool === 'force') {
      if (this.held.left || this.held.right) {
        this.clickPoint = this.pointer;
        this.clickForce = this.heldForce;
      } else if (!this.clickLock) {
        this.clickPoint = [0, 0];
        this.clickForce = 0;
      }
    }

    const boundary = this.frameBoundary(elapsed);
    return {
      clickPoint: this.clickPoint,
      clickForce: this.clickForce,
      gravity: this.frameGravity(),
      constrainCenter: boundary.center,
      constrainVelocity: boundary.velocity,
      toolEffect: this.frameToolEffect(elapsed),
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
