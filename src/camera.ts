/**
 * The boundary circle's starting radius. It alone sets the size of simulation
 * space, which the camera fits to the canvas.
 */
export const STARTING_BOUNDARY_RADIUS = 1060;

/**
 * The side of the square of simulation space a boundary circle of this radius
 * needs: its diameter plus a margin on each side of 1/53 of the radius, so the
 * circle does not touch the edge of the canvas (20 units at the default radius
 * of 1060, a square of 2160). Simulation space is sized from the boundary
 * circle alone, never from an image or a display, and in proportion to it.
 */
export function simulationSize(boundaryRadius: number): number {
  // Multiplied before dividing, so the default radius gives exactly 2160.
  return (2 * boundaryRadius * 54) / 53;
}

/**
 * How simulation space is shown on a canvas: the square of simulation space
 * the simulation occupies, centred on the origin, fitted to the canvas with
 * its proportions kept. A canvas of another shape shows more of simulation
 * space along its longer side. Simulation space has y pointing down, as the
 * canvas does.
 */
export interface Camera {
  /** Canvas pixels per unit of simulation space; 0 while the canvas has no area. */
  scale: number;
  /** Canvas size in pixels. */
  width: number;
  height: number;
}

/** Fits a square of simulation space `size` units across to a canvas of the given size in pixels. */
export function fitCamera(size: number, canvasWidth: number, canvasHeight: number): Camera {
  const width = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : 0;
  const height = Number.isFinite(canvasHeight) ? Math.max(0, canvasHeight) : 0;
  return { scale: Math.min(width, height) / size, width, height };
}

/** Maps a point in simulation space to canvas pixels. */
export function simulationToCanvas(camera: Camera, x: number, y: number): [number, number] {
  return [x * camera.scale + camera.width / 2, y * camera.scale + camera.height / 2];
}

/**
 * Maps a point in canvas pixels to simulation space. While the canvas has no
 * area every point maps to the origin.
 */
export function canvasToSimulation(camera: Camera, x: number, y: number): [number, number] {
  if (!(camera.scale > 0)) {
    return [0, 0];
  }
  return [(x - camera.width / 2) / camera.scale, (y - camera.height / 2) / camera.scale];
}

/**
 * The 4x4 matrix, column-major, that takes simulation space to clip space for
 * this camera. Clip space has y pointing up, so y is flipped.
 */
export function cameraProjection(camera: Camera): Float32Array<ArrayBuffer> {
  const sx = camera.width > 0 ? (2 * camera.scale) / camera.width : 0;
  const sy = camera.height > 0 ? (-2 * camera.scale) / camera.height : 0;
  // prettier-ignore
  return new Float32Array([
    sx, 0,  0, 0,
    0,  sy, 0, 0,
    0,  0,  1, 0,
    0,  0,  0, 1
  ]);
}
