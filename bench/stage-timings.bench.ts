// Imported first: it defines the WebGPU globals the source modules need at load.
import '../test/gpu';

import { createRequire } from 'module';
import { it } from 'vitest';

import { DEFAULT_SUBSTEP_RATE } from '../src/clock';
import { DEFAULT_COLLISION_SETTINGS } from '../src/verlet/collision';
import { scatter, SimulationInput, Verlet } from '../src/verlet/verlet';
import { mulberry32 } from '../test/sim-harness';
import { GpuStageTimer } from './gpu-stage-timer';
import { BenchResult, formatTable, StageTime } from './stage-timings';

/**
 * Measures where the time in a substep goes, at several particle counts. It
 * drives the simulation through its interface, outside any display loop, and
 * asserts nothing. Run it with `npm run bench`; see docs/testing.md.
 */

const PARTICLE_COUNTS = [15_000, 500_000, 1_000_000];
// The app's simulation space and boundary circle.
const BOUNDS = 2160;
const CONSTRAIN_RADIUS = BOUNDS / 2 - 20;
// Every scene covers this share of the boundary circle's area, with radii no
// larger than the app's 1.5, so that a million particles fit.
const FILL = 0.5;
const MAX_RADIUS = 1.5;
// Three seconds of simulated time let the scatter fall and settle into a pile
// first; while it is still collapsing, the cost of a substep keeps changing.
const WARM_UP_SUBSTEPS = 3 * DEFAULT_SUBSTEP_RATE;
const MEASURED_SUBSTEPS = 600;
// Timestamp queries are limited to 4096 per query set, 2 per stage.
const TIMED_SUBSTEPS = 200;
// The stages a substep is split into.
const MAX_STAGES = 7;
// Substeps encoded into one submitted command buffer, as one 60 Hz frame does.
const SUBSTEPS_PER_SUBMIT = 20;

const input: SimulationInput = {
  clickPoint: [0, 0],
  clickForce: 0,
  constrainRadius: CONSTRAIN_RADIUS,
  classicConstrain: false,
  collide: true,
  substepRate: DEFAULT_SUBSTEP_RATE,
  ...DEFAULT_COLLISION_SETTINGS
};

function radiusFor(count: number) {
  return Math.min(MAX_RADIUS, Math.sqrt((FILL * CONSTRAIN_RADIUS ** 2) / count));
}

/** Steps in frame-sized command buffers and waits for the GPU to finish them. */
async function run(device: GPUDevice, verlet: Verlet, substeps: number, timer?: GpuStageTimer) {
  for (let done = 0; done < substeps; done += SUBSTEPS_PER_SUBMIT) {
    const encoder = device.createCommandEncoder();
    verlet.step(encoder, Math.min(SUBSTEPS_PER_SUBMIT, substeps - done), input, timer);
    device.queue.submit([encoder.finish()]);
  }
  await device.queue.onSubmittedWorkDone();
}

async function measure(device: GPUDevice, count: number, timestamps: boolean): Promise<BenchResult> {
  const verlet = new Verlet(device, {
    bounds: BOUNDS,
    // Nothing is drawn, but the simulation is built for a canvas format.
    format: 'bgra8unorm',
    seed: () =>
      scatter({
        count,
        bounds: BOUNDS,
        radius: radiusFor(count),
        random: mulberry32(1)
      })
  });
  try {
    await run(device, verlet, WARM_UP_SUBSTEPS);

    const start = performance.now();
    await run(device, verlet, MEASURED_SUBSTEPS);
    const substepMs = (performance.now() - start) / MEASURED_SUBSTEPS;

    let stages: StageTime[] | null = null;
    if (timestamps) {
      const timer = new GpuStageTimer(device, TIMED_SUBSTEPS * MAX_STAGES);
      try {
        await run(device, verlet, TIMED_SUBSTEPS, timer);
        stages = await timer.read();
      } finally {
        timer.destroy();
      }
    }
    return { particles: count, stages, substepMs };
  } finally {
    verlet.destroy();
  }
}

it('benchmark', { timeout: 30 * 60_000 }, async () => {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.log('No GPU adapter found; nothing to measure.');
    return;
  }
  // BENCH_NO_TIMESTAMPS shows what the benchmark does on a device without them.
  const timestamps = adapter.features.has('timestamp-query') && !process.env.BENCH_NO_TIMESTAMPS;
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ['timestamp-query'] : []
  });

  const { version } = createRequire(import.meta.url)('webgpu/package.json');
  const { vendor, architecture, device: name, description } = adapter.info;
  console.log(`GPU: ${[name, vendor, architecture, description].filter(Boolean).join(' / ')}`);
  console.log(`Runtime: Node ${process.version}, Dawn via the webgpu package ${version}`);
  console.log(
    `Each scene: ${MEASURED_SUBSTEPS} substeps at ${DEFAULT_SUBSTEP_RATE} per second, ` +
      `after ${WARM_UP_SUBSTEPS} to settle; particles cover ${FILL * 100}% of the boundary circle.`
  );
  if (!timestamps) {
    console.log(
      'NOTICE: timestamp queries are unavailable, so stages are not timed; ' +
        'only the wall-clock time per substep is shown.'
    );
  }

  const results: BenchResult[] = [];
  try {
    // A validation error would make the numbers meaningless.
    device.pushErrorScope('validation');
    for (const count of PARTICLE_COUNTS) {
      const radius = radiusFor(count).toFixed(2);
      const particles = count.toLocaleString('en-US');
      console.log(`Measuring ${particles} particles, radius ${radius}...`);
      results.push(await measure(device, count, timestamps));
    }
    const error = await device.popErrorScope();
    if (error) throw new Error(`WebGPU validation error: ${error.message}`);
  } finally {
    device.destroy();
  }

  console.log(`\n${formatTable(results)}\n`);
  if (timestamps) {
    console.log(
      `Stages are GPU time from timestamp queries over ${TIMED_SUBSTEPS} substeps, ` +
        'each stage in its own compute pass. The wall clock includes submission and pass overhead.'
    );
  }
});
