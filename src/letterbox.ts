/** A rectangle within the canvas, in canvas pixels. */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The largest rectangle with the aspect ratio of simulation space that fits
 * in the canvas, centred: bars at the sides when the canvas is wider, bars at
 * top and bottom when it is taller.
 */
export function fitViewport(
  simWidth: number,
  simHeight: number,
  canvasWidth: number,
  canvasHeight: number
): Viewport {
  const simAspect = simWidth / simHeight;

  if (canvasWidth / canvasHeight > simAspect) {
    const width = canvasHeight * simAspect;
    return { x: (canvasWidth - width) / 2, y: 0, width, height: canvasHeight };
  }

  const height = canvasWidth / simAspect;
  return { x: 0, y: (canvasHeight - height) / 2, width: canvasWidth, height };
}

/**
 * Maps a point in canvas pixels to simulation space, whose origin is the
 * centre of the viewport. Points in the bars clamp to the viewport's edge.
 */
export function canvasToSimulation(
  viewport: Viewport,
  simWidth: number,
  simHeight: number,
  canvasX: number,
  canvasY: number
): [number, number] {
  const x = Math.max(0, Math.min(viewport.width, canvasX - viewport.x));
  const y = Math.max(0, Math.min(viewport.height, canvasY - viewport.y));

  return [
    (x / viewport.width) * simWidth - simWidth / 2,
    (y / viewport.height) * simHeight - simHeight / 2
  ];
}
