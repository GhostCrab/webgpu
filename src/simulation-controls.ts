import { DEFAULT_SUBSTEP_RATE } from './clock';
import type { SimulationInput } from './verlet/verlet';

/** Which way a held mouse button drives the click force. */
export type ClickButton = 'attract' | 'repel';

/**
 * The simulation controls: the user-adjustable state of the simulation, and
 * the rules that turn pointer and button actions into simulation input.
 *
 * Knows nothing about the DOM or the GPU. The keyboard and mouse bindings and
 * the settings panel both drive this one object.
 */
export class SimulationControls {
  // Settings. The settings panel reads and writes these directly.
  collide = true;
  paused = false;
  /** Keeps the click force active after the button is released. */
  clickLock = false;
  classicConstrain = false;
  constrainRadius: number;
  /** Strength a click force takes when a button is pressed. */
  impulse = 2000;
  /** Substeps per second of simulated time: the simulation's accuracy. */
  substepRate = DEFAULT_SUBSTEP_RATE;

  private pointer: [number, number] = [0, 0];
  private held: Record<ClickButton, boolean> = { attract: false, repel: false };
  private heldForce = 0;
  private clickPoint: [number, number] = [0, 0];
  private clickForce = 0;

  constructor(options: { constrainRadius: number }) {
    this.constrainRadius = options.constrainRadius;
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
      substepRate: this.substepRate
    };
  }
}
