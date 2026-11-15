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

`test/sim-harness.ts` is the test surface for the simulation: place particles, advance them by a number of substeps (`sim.step(20)` is one 60 Hz frame at the default rate of 1200 per second; `substepRate` is an input), read particles back, render to an offscreen canvas. Add scenarios through it; tests do not build pipelines themselves.

- It runs every GPU operation inside a validation error scope and checks the scopes when a test reads a result and when the test ends, so a WebGPU validation error fails the test that caused it.
- It destroys each sim's GPU resources when its test ends. Each sim holds a full-size simulation target, several hundred MB of GPU memory.
- `test/gpu.ts` defines the WebGPU globals. Import it (or the harness) before any source module that needs them, including `particle-layout.ts`, which parses WGSL at load.

## What can be asserted

Binning uses atomics, so the order particles are visited in differs between runs, and the four-pass collide races (see `docs/architecture.md`). For both reasons **individual particle positions are not reproducible** in multi-particle runs. Assert on one of:

- **Hand-computable results** for one or two particles (free fall, a click force, the boundary).
- **Invariants**: no non-finite values, every particle inside the boundary circle, every particle in exactly one bin list.
- **Aggregate statistics with a tolerance**, from `runStats`.

The aggregate ranges in `simulation.test.ts` are measured values. If a deliberate behaviour change moves them, re-measure over at least four runs and widen each range to several times the spread.

## Checking a claim by running it

A claim about what the simulation does ("this particle ends outside the boundary circle") is a guess until it has run. Write a throwaway scenario through the harness in a new file under `test/`, run that one file, report what it printed, and delete the file unless it is becoming a real test. This applies to research and review as much as to implementation.

## Pure modules

`clock.ts`, `simulation-controls.ts`, `letterbox.ts`, `binGrid`, `scatter` and the particle layout are tested without a GPU.
