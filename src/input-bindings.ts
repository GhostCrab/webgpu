import { GameInputs } from 'game-inputs';

import { POINTER_TOOLS } from './pointer-tools';
import { SimulationControls } from './simulation-controls';

export interface InputBindingOptions {
  /** Maps a pointer position in page coordinates to simulation space. */
  toSimulation: (pageX: number, pageY: number) => [number, number];
  /** The wheel over this element scales the pointer tool's reach. */
  wheelTarget: HTMLElement;
  onReset: () => void;
}

/**
 * Drives the simulation controls from the mouse and keyboard: the mouse
 * buttons and wheel work the pointer tool, and 1 to 7 choose it; G levels;
 * holding S spawns at the pointer, holding E erases at the pointer,
 * R resets, C toggles collision, T the constrain mode, P pause, L click lock.
 *
 * Returns a function to call once per frame.
 */
export function bindInputs(controls: SimulationControls, options: InputBindingOptions): () => void {
  const inputs = new GameInputs(undefined, {
    preventDefaults: false,
    allowContextMenu: false,
    stopPropagation: false,
    disabled: false
  });

  inputs.bind('LMB', 'Mouse1');
  inputs.bind('RMB', 'Mouse3');
  inputs.bind('spawn', 'KeyS');
  inputs.bind('erase', 'KeyE');
  inputs.bind('reset', 'KeyR');
  inputs.bind('collideToggle', 'KeyC');
  inputs.bind('classicConstrainToggle', 'KeyT');
  inputs.bind('pauseToggle', 'KeyP');
  inputs.bind('clickLockToggle', 'KeyL');
  inputs.bind('level', 'KeyG');
  POINTER_TOOLS.forEach(({ id }, i) => {
    inputs.bind(id, `Digit${i + 1}`);
    inputs.down.on(id, () => (controls.tool = id));
  });

  document.onmousemove = (event: MouseEvent) => {
    controls.movePointer(...options.toSimulation(event.pageX, event.pageY));
  };

  inputs.down.on('LMB', () => controls.pressButton('left'));
  inputs.up.on('LMB', () => controls.releaseButton('left'));
  inputs.down.on('RMB', () => controls.pressButton('right'));
  inputs.up.on('RMB', () => controls.releaseButton('right'));
  inputs.down.on('level', () => controls.level());
  options.wheelTarget.addEventListener(
    'wheel',
    (event: WheelEvent) => controls.scaleToolRadius(event.deltaY > 0 ? 1 / 1.1 : 1.1),
    { passive: true }
  );
  inputs.down.on('spawn', () => controls.startSpawning());
  inputs.up.on('spawn', () => controls.stopSpawning());
  inputs.down.on('erase', () => controls.startErasing());
  inputs.up.on('erase', () => controls.stopErasing());

  inputs.down.on('collideToggle', () => controls.toggle('collide'));
  inputs.down.on('pauseToggle', () => controls.toggle('paused'));
  inputs.down.on('clickLockToggle', () => controls.toggle('clickLock'));
  inputs.down.on('classicConstrainToggle', () => controls.toggle('classicConstrain'));

  inputs.down.on('reset', options.onReset);

  return () => inputs.tick();
}
