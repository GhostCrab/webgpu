# Testing

Tests live in `test/` and run under Vitest. The GPU tests run the **real WGSL pipelines** in Node through Dawn (the `webgpu` npm package). There is no CPU copy of the simulation to keep in sync.

```bash
npm test                                      # everything, once
npx vitest run test/simulation.test.ts        # one file
npx vitest run -t "falls under gravity"       # tests matching a name
```

## Environment

- GPU tests need a real GPU and skip themselves when no adapter is found. The development machine has no software fallback adapter.
- Node 21 or newer is required: the setup relies on the `navigator` global.
- In Git Bash, run Vitest from a path with an upper-case drive letter (`cd "C:/Users/..."`). From a lower-case `c:` working directory Vitest fails with "failed to find the current suite". PowerShell and the pre-commit hook are unaffected.

## The harness

`test/sim-harness.ts` is the test surface for the simulation: place particles, step whole frames, read particles back, render to an offscreen canvas. Add scenarios through it; tests do not build pipelines themselves.

- It runs every GPU operation inside a validation error scope and checks the scopes when a test reads a result and when the test ends, so a WebGPU validation error fails the test that caused it.
- It destroys each sim's GPU resources when its test ends. Each sim holds a full-size simulation target, several hundred MB of GPU memory.
- `test/gpu.ts` defines the WebGPU globals. Import it (or the harness) before any source module that needs them, including `particle-layout.ts`, which parses WGSL at load.

## What can be asserted

Binning uses atomics, so the order particles are visited in differs between runs, and **individual particle positions are not reproducible** in multi-particle runs. Assert on one of:

- **Hand-computable results** for one or two particles (free fall, a click force, the boundary).
- **Invariants**: no non-finite values, every particle inside the boundary circle, every particle in exactly one bin list.
- **Aggregate statistics with a tolerance**, from `runStats`.

The aggregate ranges in `simulation.test.ts` are measured values. If a deliberate behaviour change moves them, re-measure over at least four runs and widen each range to several times the spread.

## Pure modules

`simulation-controls.ts`, `letterbox.ts`, `binGrid`, `scatter` and the particle layout are tested without a GPU.
