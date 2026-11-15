import { SimulationControls } from './simulation-controls';

// lil-gui is loaded via CDN in index.html
declare const lil: any;

export interface GuiStats {
  particleCount: number;
  substeps: number;
  simWidth: number;
  simHeight: number;
}

/**
 * The settings panel. Its controls are bound straight to the simulation
 * controls object, so the panel and the keyboard shortcuts share one state.
 */
export default class GuiWrapper {
  gui: any;
  private stats: { fps: string | number; particleCount: number; stepCount: number; simResolution: string };

  constructor(controls: SimulationControls, stats: GuiStats, onReset: () => void) {
    this.gui = new lil.GUI({ title: 'Debug Controls' });

    this.stats = {
      fps: 0,
      particleCount: stats.particleCount,
      stepCount: stats.substeps,
      simResolution: `${stats.simWidth}x${stats.simHeight}`
    };
    const statsFolder = this.gui.addFolder('Stats');
    statsFolder.add(this.stats, 'fps').disable().listen();
    statsFolder.add(this.stats, 'particleCount').disable();
    statsFolder.add(this.stats, 'stepCount').disable();
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

    this.gui.add({ reset: onReset }, 'reset').name('Reset (R)');

    statsFolder.open();
    simulation.open();
    parameters.open();
  }

  updateFPS(fps: number) {
    this.stats.fps = fps.toFixed(1);
  }

  destroy() {
    this.gui.destroy();
  }
}
