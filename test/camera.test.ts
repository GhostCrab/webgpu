import { describe, expect, test } from 'vitest';

import { canvasToSimulation, fitCamera, simulationToCanvas } from '../src/camera';

const expectPoint = (actual: [number, number], expected: [number, number]) => {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
};

describe('fitting simulation space to the canvas', () => {
  test('a wider canvas fits simulation space to its height, centred', () => {
    // 2000 units of simulation space across a 900-pixel height.
    const camera = fitCamera(2000, 1600, 900);
    expect(camera.scale).toBeCloseTo(0.45);
    expectPoint(simulationToCanvas(camera, 0, 0), [800, 450]);
    expectPoint(simulationToCanvas(camera, -1000, -1000), [350, 0]);
    expectPoint(simulationToCanvas(camera, 1000, 1000), [1250, 900]);
  });

  test('a taller canvas fits simulation space to its width, centred', () => {
    const camera = fitCamera(2000, 900, 1600);
    expect(camera.scale).toBeCloseTo(0.45);
    expectPoint(simulationToCanvas(camera, -1000, -1000), [0, 350]);
    expectPoint(simulationToCanvas(camera, 1000, 1000), [900, 1250]);
  });

  test('a canvas with no area has a scale of 0', () => {
    for (const [width, height] of [[0, 0], [800, 0], [NaN, 600]]) {
      expect(fitCamera(2000, width, height).scale).toBe(0);
    }
  });
});

describe('mapping the pointer into simulation space', () => {
  test('the centre of the canvas is the origin, with y pointing down', () => {
    const camera = fitCamera(2000, 1600, 900);
    expectPoint(canvasToSimulation(camera, 800, 450), [0, 0]);
    expectPoint(canvasToSimulation(camera, 800, 0), [0, -1000]);
    expectPoint(canvasToSimulation(camera, 800, 900), [0, 1000]);
  });

  test('beyond the fitted square, a wider canvas shows more of simulation space', () => {
    const camera = fitCamera(2000, 1600, 900);
    expectPoint(canvasToSimulation(camera, 0, 450), [-800 / 0.45, 0]);
  });

  test('is the inverse of drawing', () => {
    for (const [width, height] of [[1600, 900], [900, 1600], [1920, 1080], [333, 777]]) {
      const camera = fitCamera(2160, width, height);
      for (const point of [[0, 0], [-1060, 1060], [523.25, -17.5]] as [number, number][]) {
        expectPoint(canvasToSimulation(camera, ...simulationToCanvas(camera, ...point)), point);
      }
    }
  });

  test('a click lands at the same point in simulation space at any window size', () => {
    const at1080p = canvasToSimulation(fitCamera(2160, 1920, 1080), 480, 270);
    const at4k = canvasToSimulation(fitCamera(2160, 3840, 2160), 960, 540);
    const smallWindow = canvasToSimulation(fitCamera(2160, 960, 540), 240, 135);
    // Half a unit per pixel at 1080p.
    expectPoint(at1080p, [-960, -540]);
    expectPoint(at4k, at1080p);
    expectPoint(smallWindow, at1080p);
  });

  test('a canvas with no area maps every point to the origin', () => {
    expect(canvasToSimulation(fitCamera(2000, 800, 0), 400, 0)).toEqual([0, 0]);
    expect(canvasToSimulation(fitCamera(2000, 0, 0), 0, 0)).toEqual([0, 0]);
  });
});
