import { Camera, simulationToCanvas } from './camera';
import type { ToolOutline } from './simulation-controls';

const ACTIVE = 'rgba(120, 170, 255, 0.8)';
const IDLE = 'rgba(255, 255, 255, 0.25)';
const LINE_WIDTH = 2;

/**
 * Outlines the pointer tool over the simulation, on a 2D canvas laid over the
 * simulation's canvas. It ignores the pointer, so every click reaches the
 * page beneath.
 */
export class ToolOverlay {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  /** Lays the overlay over `canvas`, inside its parent. */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    canvas.parentElement.appendChild(this.canvas);
    this.context = this.canvas.getContext('2d');
  }

  /**
   * Draws `outline` through `camera`, which maps simulation space to canvas
   * pixels, or clears the overlay for none. `width` and `height` are the
   * simulation canvas's, in pixels.
   */
  draw(outline: ToolOutline | null, camera: Camera, width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const g = this.context;
    g.clearRect(0, 0, width, height);
    if (!outline || camera.scale <= 0) return;

    g.lineWidth = LINE_WIDTH * window.devicePixelRatio;
    g.beginPath();
    if (outline.kind === 'circle') {
      const [x, y] = simulationToCanvas(camera, ...outline.center);
      g.arc(x, y, Math.max(outline.radius * camera.scale, 0), 0, 2 * Math.PI);
      g.strokeStyle = outline.active ? ACTIVE : IDLE;
    } else {
      g.moveTo(...simulationToCanvas(camera, ...outline.from));
      g.lineTo(...simulationToCanvas(camera, ...outline.to));
      g.strokeStyle = IDLE;
    }
    g.stroke();
  }

  destroy() {
    this.canvas.remove();
  }
}
