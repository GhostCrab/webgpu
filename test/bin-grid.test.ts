// Imported first: it defines the WebGPU globals the source modules need at load.
import { getDevice } from './gpu';

import { describe, expect, test } from 'vitest';

import { BinGridSize, sizeBinGrid } from '../src/verlet/bin-grid';
import { BinGridContents, BOUNDS, createSim, RADIUS, seededScatter } from './sim-harness';

const device = await getDevice();

describe('sizing the bin grid', () => {
  test('makes bins one diameter of the largest radius in use wide, covering the bounds', () => {
    expect(sizeBinGrid({ bounds: 2160, largestRadius: 1.5, minBinSize: 1 })).toEqual({
      binSize: 3,
      width: 720,
      height: 720,
      binCount: 518400
    });
  });

  test('never makes a bin smaller than the configured minimum', () => {
    expect(sizeBinGrid({ bounds: 2160, largestRadius: 0.5, minBinSize: 2 })).toEqual({
      binSize: 2,
      width: 1080,
      height: 1080,
      binCount: 1166400
    });
  });

  test('adds a part-filled bin when the bin size does not divide the bounds', () => {
    // 100 / 3 = 33.3 bins.
    expect(sizeBinGrid({ bounds: 100, largestRadius: 1.5, minBinSize: 1 })).toMatchObject({
      binSize: 3,
      width: 34,
      height: 34
    });
  });

  test('keeps a bin size that is not a whole number', () => {
    expect(sizeBinGrid({ bounds: 100, largestRadius: 1.25, minBinSize: 1 })).toMatchObject({
      binSize: 2.5,
      width: 40
    });
  });
});

/** The bin a position falls in, by the grid's definition: clamped into the grid. */
function binAt(grid: BinGridSize, x: number, y: number): [number, number] {
  const cell = (v: number, size: number) =>
    Math.min(Math.max(Math.floor((v + BOUNDS / 2) / grid.binSize), 0), size - 1);
  return [cell(x, grid.width), cell(y, grid.height)];
}

// The GPU computes bins in 32-bit floats, so a position this close to a bin
// edge may be placed on either side of it.
const EDGE_TOLERANCE = 1e-3;

/** Whether a particle at x, y may be in `bin`, allowing for rounding at bin edges. */
function mayBeIn(grid: BinGridSize, bin: number, x: number, y: number): boolean {
  const target = [bin % grid.width, Math.floor(bin / grid.width)];
  return [-1, 1].some((sx) =>
    [-1, 1].some((sy) => {
      const [bx, by] = binAt(grid, x + sx * EDGE_TOLERANCE, y + sy * EDGE_TOLERANCE);
      return bx === target[0] && by === target[1];
    })
  );
}

/** The bin each slot of the particle buffer belongs to, according to the bin starts. */
function binOfEachSlot({ grid, binStarts, particles }: BinGridContents): number[] {
  const bins: number[] = [];
  for (let bin = 0; bin < grid.binCount; bin++) {
    for (let slot = binStarts[bin]; slot < binStarts[bin + 1]; slot++) bins.push(bin);
  }
  expect(bins).toHaveLength(particles.length);
  return bins;
}

/**
 * Checks a built bin grid: every particle once, each in the run of the bin its
 * position falls in, and in particle id order within its bin.
 */
function expectBuilt(contents: BinGridContents, count: number) {
  const { grid, binStarts, particles } = contents;
  expect(binStarts).toHaveLength(grid.binCount + 1);
  expect(binStarts[0]).toBe(0);
  expect(binStarts[grid.binCount]).toBe(count);

  const ids = particles.map((p) => p.id).sort((a, b) => a - b);
  expect(ids).toEqual(Array.from({ length: count }, (_, i) => i));

  const bins = binOfEachSlot(contents);
  let misplaced = 0;
  let outOfOrder = 0;
  particles.forEach((p, slot) => {
    if (!mayBeIn(grid, bins[slot], p.x, p.y)) misplaced++;
    if (slot > 0 && bins[slot - 1] === bins[slot] && particles[slot - 1].id > p.id) outOfOrder++;
  });
  expect({ misplaced, outOfOrder }).toEqual({ misplaced: 0, outOfOrder: 0 });
}

/**
 * A scatter in bins 100 units wide, the smallest bin size set, so that each
 * holds about 30 particles: enough for the order threads finish in to vary.
 */
const CROWDED_BIN_SIZE = 100;
function crowdedBins() {
  return createSim(seededScatter(15000, 99), { minBinSize: CROWDED_BIN_SIZE });
}

describe.skipIf(!device)('the bin grid', () => {
  test('holds every particle once, grouped by bin and in particle id order within each bin', async () => {
    const sim = await crowdedBins();
    const contents = await sim.readBinGrid();
    expect(contents.grid).toEqual(
      sizeBinGrid({ bounds: BOUNDS, largestRadius: RADIUS, minBinSize: CROWDED_BIN_SIZE })
    );
    expectBuilt(contents, 15000);
  });

  test('gives the same order on repeated runs while particles move between bins', async () => {
    const runs = [];
    for (let run = 0; run < 2; run++) {
      const sim = await crowdedBins();
      // Three frames: the scatter's particles cross bins as they fall.
      sim.step(60);
      runs.push(await sim.readBinGrid());
    }
    expectBuilt(runs[0], 15000);
    expect(runs[1].particles).toEqual(runs[0].particles);
    expect(runs[1].binStarts).toEqual(runs[0].binStarts);
  });

  test('puts a particle outside the grid in the nearest edge bin', async () => {
    const grid = sizeBinGrid({ bounds: BOUNDS, largestRadius: 1.5, minBinSize: 3 });
    const { width, height, binSize } = grid;
    const edge = BOUNDS / 2;
    // Beyond the right, left and bottom edges, and beyond a corner, each in a
    // row or column where a wrapped index would land in the wrong bin.
    const outside = [
      { x: edge + 50, y: 0 },
      { x: -edge - 50, y: 100 },
      { x: 200, y: edge + 50 },
      { x: -edge - 5e9, y: -edge - 5e9 }
    ];
    const expected = [
      [width - 1, height / 2],
      [0, height / 2 + Math.floor(100 / binSize)],
      [width / 2 + Math.floor(200 / binSize), height - 1],
      [0, 0]
    ];
    const sim = await createSim([...outside, { x: 0, y: 0 }]);
    const contents = await sim.readBinGrid();
    expect(contents.grid).toEqual(grid);
    expectBuilt(contents, outside.length + 1);

    const bins = binOfEachSlot(contents);
    const binOf = (id: number) => {
      const bin = bins[contents.particles.findIndex((p) => p.id === id)];
      return [bin % width, Math.floor(bin / width)];
    };
    expect(outside.map((_, id) => binOf(id))).toEqual(expected);
  });

  test('builds a grid of millions of bins', async () => {
    // Bins 1 unit wide: 2160 x 2160, over 4.6 million.
    const particles = seededScatter(15000, 7).map((p) => ({ ...p, radius: 0.5 }));
    const sim = await createSim(particles, { minBinSize: 1 });
    const contents = await sim.readBinGrid();
    expect(contents.grid.binCount).toBe(2160 * 2160);
    expectBuilt(contents, particles.length);
  });
});
