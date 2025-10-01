// lil-gui is loaded via CDN in index.html
declare const lil: any;

export default class GuiWrapper {
  gui: any;
  params: any;
  folders: { [key: string]: any } = {};

  constructor() {
    this.gui = new lil.GUI({ title: 'Debug Controls' });
    this.params = {};
  }

  init(config: {
    particleCount: number;
    doCollision: boolean;
    paused: boolean;
    clickLock: boolean;
    classicConstrain: boolean;
    constrainRadius: number;
    impulse: number;
    stepCount: number;
    simWidth: number;
    simHeight: number;
  }, callbacks: {
    onCollisionToggle: () => void;
    onPauseToggle: () => void;
    onClickLockToggle: () => void;
    onClassicConstrainToggle: () => void;
    onReset: () => void;
    onConstrainRadiusChange?: (value: number) => void;
    onImpulseChange?: (value: number) => void;
  }) {
    // Stats folder
    this.folders.stats = this.gui.addFolder('Stats');
    this.params.fps = 0;
    this.params.particleCount = config.particleCount;
    this.params.stepCount = config.stepCount;
    this.params.simResolution = `${config.simWidth}x${config.simHeight}`;
    this.folders.stats.add(this.params, 'fps').disable().listen();
    this.folders.stats.add(this.params, 'particleCount').disable();
    this.folders.stats.add(this.params, 'stepCount').disable();
    this.folders.stats.add(this.params, 'simResolution').name('Sim Resolution').disable();

    // Simulation controls
    this.folders.simulation = this.gui.addFolder('Simulation');
    this.params.doCollision = config.doCollision;
    this.params.paused = config.paused;
    this.params.clickLock = config.clickLock;
    this.params.classicConstrain = config.classicConstrain;

    this.folders.simulation.add(this.params, 'doCollision').name('Collision (C)').onChange(callbacks.onCollisionToggle);
    this.folders.simulation.add(this.params, 'paused').name('Paused (P)').onChange(callbacks.onPauseToggle);
    this.folders.simulation.add(this.params, 'clickLock').name('Click Lock (L)').onChange(callbacks.onClickLockToggle);
    this.folders.simulation.add(this.params, 'classicConstrain').name('Classic Constrain (T)').onChange(callbacks.onClassicConstrainToggle);

    // Parameters
    this.folders.params = this.gui.addFolder('Parameters');
    this.params.constrainRadius = config.constrainRadius;
    this.params.impulse = config.impulse;

    if (callbacks.onConstrainRadiusChange) {
      this.folders.params.add(this.params, 'constrainRadius', 50, 1000).name('Constrain Radius').onChange(callbacks.onConstrainRadiusChange);
    }

    if (callbacks.onImpulseChange) {
      this.folders.params.add(this.params, 'impulse', 0, 10000).name('Mouse Impulse').onChange(callbacks.onImpulseChange);
    }

    // Actions
    this.params.reset = callbacks.onReset;
    this.gui.add(this.params, 'reset').name('Reset (R)');

    // Expand folders by default
    this.folders.stats.open();
    this.folders.simulation.open();
    this.folders.params.open();
  }

  updateFPS(fps: number) {
    this.params.fps = fps.toFixed(1);
  }

  updateParams(params: Partial<{
    doCollision: boolean;
    paused: boolean;
    clickLock: boolean;
    classicConstrain: boolean;
  }>) {
    Object.assign(this.params, params);
  }

  destroy() {
    this.gui.destroy();
  }
}
