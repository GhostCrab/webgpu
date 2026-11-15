import type { ClockTick } from './clock';
import { SimulationControls } from './simulation-controls';
import { MAX_RADIUS_RATIO } from './verlet/capacity';

/** The radius the default seed gives every particle, and so the smallest to spawn. */
const SEED_RADIUS = 1.5;

// lil-gui is loaded via CDN in index.html, so it has no type definitions here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const lil: any;

export interface GuiStats {
  particleCount: number;
  /** Side of the square of simulation space, in its own units. */
  simulationSize: number;
}

/**
 * The settings panel. Its controls are bound straight to the simulation
 * controls object, so the panel and the keyboard shortcuts share one state.
 */
export default class GuiWrapper {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gui: any;
  private stats: {
    fps: string | number;
    particleCount: string;
    substeps: string;
    simulationSize: string;
  };

  /** `onRestart` makes a new simulation, at the capacity now set. */
  constructor(
    controls: SimulationControls,
    stats: GuiStats,
    onReset: () => void,
    onRestart: () => void
  ) {
    this.gui = new lil.GUI({ title: 'Debug Controls' });

    this.stats = {
      fps: 0,
      particleCount: `${stats.particleCount} / ${controls.capacity}`,
      substeps: '0 / 0',
      simulationSize: `${stats.simulationSize} units`
    };
    const statsFolder = this.gui.addFolder('Stats');
    statsFolder.add(this.stats, 'fps').disable().listen();
    statsFolder.add(this.stats, 'particleCount').name('Particles / capacity').disable().listen();
    statsFolder.add(this.stats, 'substeps').name('Substeps run / wanted').disable().listen();
    statsFolder.add(this.stats, 'simulationSize').name('Simulation Size').disable();

    // listen() keeps the panel in step when a keyboard shortcut changes a setting.
    const simulation = this.gui.addFolder('Simulation');
    simulation.add(controls, 'collide').name('Collision (C)').listen();
    simulation.add(controls, 'paused').name('Paused (P)').listen();
    simulation.add(controls, 'clickLock').name('Click Lock (L)').listen();
    simulation.add(controls, 'classicConstrain').name('Classic Constrain (T)').listen();

    const parameters = this.gui.addFolder('Parameters');
    // Known: the range stops below the starting radius (GitHub issue #3).
    parameters.add(controls, 'constrainRadius', 50, 1000).name('Constrain Radius');
    parameters.add(controls, 'impulse', 0, 10000).name('Mouse Impulse');
    parameters.add(controls, 'substepRate', 240, 4800, 60).name('Substeps per Second');
    parameters.add(controls, 'relaxation', 0.5, 2, 0.05).name('Relaxation');
    parameters.add(controls, 'particleRestitution', 0, 1, 0.05).name('Particle Restitution');
    parameters.add(controls, 'particleDamping', 0, 1, 0.05).name('Particle Damping');

    const spawn = this.gui.addFolder('Spawn (hold S)');
    spawn.add(controls, 'spawnRate', 0, 20000, 60).name('Particles per Second');
    spawn
      .add(controls, 'spawnRadius', SEED_RADIUS, SEED_RADIUS * MAX_RADIUS_RATIO, 0.25)
      .name('Radius');
    spawn.addColor(controls, 'spawnColor').name('Colour');
    spawn
      .add(controls, 'capacity', 1000, 2000000, 1000)
      .name('Capacity (restarts)')
      .onFinishChange(onRestart);

    this.gui.add({ reset: onReset }, 'reset').name('Reset (R)');

    statsFolder.open();
    simulation.open();
    parameters.open();
    spawn.open();
  }

  /** Shows the live particles against the capacity. */
  updateParticles(count: number, capacity: number) {
    this.stats.particleCount = `${count} / ${capacity}`;
  }

  /** Shows one frame's rate and the substeps it ran against those it wanted. */
  updateFrame(fps: number, tick: ClockTick) {
    this.stats.fps = fps.toFixed(1);
    this.stats.substeps = `${tick.substeps} / ${tick.wanted}`;
  }

  destroy() {
    this.gui.destroy();
  }
}
