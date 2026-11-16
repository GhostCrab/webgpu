import { GameInputs } from 'game-inputs';

import { SimulationControls } from './simulation-controls';

export interface InputBindingOptions {
  /** Maps a pointer position in page coordinates to simulation space. */
  toSimulation: (pageX: number, pageY: number) => [number, number];
  onReset: () => void;
}

/**
 * Drives the simulation controls from the mouse and keyboard:
 * left button attracts, right button repels, holding S spawns at the pointer,
 * holding E erases at the pointer,
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

  document.onmousemove = (event: MouseEvent) => {
    controls.movePointer(...options.toSimulation(event.pageX, event.pageY));
  };

  inputs.down.on('LMB', () => controls.press('attract'));
  inputs.up.on('LMB', () => controls.release('attract'));
  inputs.down.on('RMB', () => controls.press('repel'));
  inputs.up.on('RMB', () => controls.release('repel'));
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
