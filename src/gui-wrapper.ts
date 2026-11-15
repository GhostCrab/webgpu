import type { ClockTick } from './clock';
import { SimulationControls } from './simulation-controls';

// lil-gui is loaded via CDN in index.html, so it has no type definitions here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const lil: any;

export interface GuiStats {
  particleCount: number;
  simWidth: number;
  simHeight: number;
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
    particleCount: number;
    substeps: string;
    simResolution: string;
  };

  constructor(controls: SimulationControls, stats: GuiStats, onReset: () => void) {
    this.gui = new lil.GUI({ title: 'Debug Controls' });

    this.stats = {
      fps: 0,
      particleCount: stats.particleCount,
      substeps: '0 / 0',
      simResolution: `${stats.simWidth}x${stats.simHeight}`
    };
    const statsFolder = this.gui.addFolder('Stats');
    statsFolder.add(this.stats, 'fps').disable().listen();
    statsFolder.add(this.stats, 'particleCount').disable();
    statsFolder.add(this.stats, 'substeps').name('Substeps run / wanted').disable().listen();
    statsFolder.add(this.stats, 'simResolution').name('Sim Resolution').disable();

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

    this.gui.add({ reset: onReset }, 'reset').name('Reset (R)');

    statsFolder.open();
    simulation.open();
    parameters.open();
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
