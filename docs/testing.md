# Testing

Tests live in `test/` and run under Vitest. The GPU tests run the **real WGSL pipelines** in Node through Dawn (the `webgpu` npm package). There is no CPU copy of the simulation to keep in sync.

```bash
npm test                                      # everything, once
npx vitest run test/simulation.test.ts        # one file
npx vitest run -t "falls under gravity"       # tests matching a name
```

## Environment

- GPU tests need a real GPU and skip themselves when no adapter is found. The development machine has no software fallback adapter.
- Node 24 or newer is required: the setup relies on the `navigator` global, and the WGSL parser behind the particle layout needs `Float16Array`.
- In Git Bash, run Vitest from a path with an upper-case drive letter (`cd "C:/Users/..."`). From a lower-case `c:` working directory Vitest fails with "failed to find the current suite". PowerShell and the pre-commit hook are unaffected.

## The harness

`test/sim-harness.ts` is the test surface for the simulation: place particles, advance them by a number of substeps (`sim.step(20)` is one 60 Hz frame at the harness's rate of 1200 per second, half the app's default; `substepRate` is an input), read particles back, render to an offscreen canvas. Add scenarios through it; tests do not build pipelines themselves.

- Particles are placed and read with a velocity in simulation units per second, and read back ordered by particle id.
- `readBinGrid()` runs one bin grid build on its own and returns the particles in the order they sit in memory, with each bin's start; `test/bin-grid.test.ts` checks builds through it. The GPU computes bins in 32-bit floats, so a particle within a hair of a bin edge may sit in either bin; those checks allow for it.
- `createSim(particles, { minBinSize })` sets the smallest bin size, for tests of large bin grids.
- It runs every GPU operation inside a validation error scope and checks the scopes when a test reads a result and when the test ends, so a WebGPU validation error fails the test that caused it.
- It destroys each sim's GPU resources when its test ends. Each sim holds a full-size simulation target, several hundred MB of GPU memory.
- `test/gpu.ts` defines the WebGPU globals. Import it (or the harness) before any source module that needs them, including `particle-layout.ts`, which parses WGSL at load.

## What can be asserted

The simulation is deterministic ([ADR-0001](adr/0001-run-to-run-determinism-on-a-fixed-substep.md)): a scene run twice on the same machine, with no user input, gives identical particles, and a test asserts it. No pass writes another particle or depends on the order atomic operations complete in; `docs/architecture.md` describes how the bin grid ([ADR-0003](adr/0003-dense-counting-sort-bin-grid-not-a-spatial-hash.md)) and the collision solve ([ADR-0002](adr/0002-jacobi-gather-collision-solver.md)) keep to that. Exact positions still differ between GPUs and browsers, so **no exact multi-particle positions are stored as baselines**. Assert on one of:

- **Hand-computable results** for one or two particles: free fall, a click force, the boundary, momentum and restitution in a two-particle collision.
- **Invariants**: no non-finite values, every particle inside the boundary circle, no speed above the speed limit, every particle exactly once in the bin grid.
- **Aggregate statistics with a tolerance**, from `runStats`: residual overlap, touching pairs, mean speed of a settled pile.
- **Run-twice equality**: run the same scene twice in one test and require identical particles.

The aggregate ranges in `simulation.test.ts` are measured values. Runs of one scene do not vary on one machine, so if a deliberate behaviour change moves them, re-measure over at least four scatter seeds and widen each range to several times the spread.

## Checking a claim by running it

A claim about what the simulation does ("this particle ends outside the boundary circle") is a guess until it has run. Write a throwaway scenario through the harness in a new file under `test/`, run that one file, report what it printed, and delete the file unless it is becoming a real test. This applies to research and review as much as to implementation.

## Benchmark

```bash
npm run bench
BENCH_NO_TIMESTAMPS=1 npm run bench           # as on a device without timestamp queries
```

`bench/stage-timings.bench.ts` measures where the time in a substep goes, at 15,000, 500,000 and 1,000,000 particles, and prints one table. It is a measuring tool, not a test: it asserts nothing and `npm test` does not run it. Vitest runs it only because Vitest already loads WGSL and the WebGPU globals; it has its own config, `vitest.bench.config.mts`.

- It builds each scene through the simulation interface, lets it settle for three seconds of simulated time, then advances it in frame-sized command buffers, outside any display loop, and prints a table of milliseconds per substep.
- With timestamp queries, `Verlet.step` is given a stage timer and runs each stage of a substep in its own compute pass with timestamp writes; the table shows each stage's GPU time and their sum. The simulation never asks for the feature itself.
- Without them, it prints a notice and only the wall-clock time per substep.
- It needs a GPU and prints the adapter and runtime it ran on. Record those with any numbers you report; baselines are posted on the spec issue (#9).

## Pure modules

`clock.ts`, `simulation-controls.ts`, `letterbox.ts`, `sizeBinGrid`, `scatter`, the particle layout and the benchmark's table formatting are tested without a GPU.
