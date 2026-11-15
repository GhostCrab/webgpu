# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GPU-driven 2D Verlet particle simulation (15,000 colliding balls) running in WebGPU compute shaders. It was forked from the `webgpu-seed` hello-triangle template, so `readme.md`, `package.json` metadata, `.travis.yml`, and the "webgpu-seed" strings in `webpack.ts` describe the upstream template, not this project.

Domain terms (particle, bin, substep, simulation input, and so on) are defined in `GLOSSARY.md`. The shader structs keep the older name `VerletObject` for a particle.

## Commands

```bash
npm install
npm run dev         # webpack --watch (development) + http-server, together
npm run prod        # same, minified
npm run prod-build  # one-off production build, no server
npm run serve       # http-server only
npm test            # Vitest: all tests, once
npm run typecheck   # tsc --noEmit
npx vitest run test/simulation.test.ts        # one test file
npx vitest run -t "falls under gravity"       # tests matching a name
```

- Open `http://localhost:8080`. `index.html` lives at the repo root and loads `dist/main.js`; there is no dev-server reload, so refresh the page after webpack rebuilds.
- There is no `build` script, although `npm start` and `.travis.yml` both call `npm run build`. Use `npm run dev` or `npm run prod-build`.
- There is no linter. Formatting is Prettier (`.prettierrc`: 2 spaces, single quotes, semicolons, no trailing commas).
- The build is `ts-node webpack.ts`, a script that drives the webpack Node API directly (there is no `webpack.config.*`). `ts-loader` runs with `transpileOnly: true`, so **the build never reports type errors**. Run `npm run typecheck`. It covers `src/` only, not `test/`.
- `.gitignore` ignores `*.js` and `*.sh` everywhere (except `webpack.*`), so new files with those extensions will not be tracked.
- A WebGPU-capable browser is required. `lil-gui` is loaded from a CDN `<script>` tag in `index.html` and used as the global `lil`; it is not an npm dependency.

## Tests

Tests live in `test/` and run under Vitest. The GPU tests run the **real WGSL pipelines** in Node through Dawn (the `webgpu` npm package); there is no CPU copy of the simulation to keep in sync.

- GPU tests need a real GPU and skip themselves when no adapter is found. This machine has no software fallback adapter.
- In Git Bash, run Vitest from a path with an upper-case drive letter (`cd "C:/Users/..."`). From a lower-case `c:` working directory Vitest fails with "failed to find the current suite". PowerShell is unaffected.
- `test/sim-harness.ts` is the test surface for the simulation: place particles, step whole frames, read particles back, render to an offscreen canvas. Add scenarios through it instead of building pipelines in tests. It runs every GPU operation inside a validation error scope, so a WebGPU validation error fails the test that caused it, and it destroys each sim's GPU resources when its test ends.
- Binning uses atomics, so the order particles are visited in differs between runs and **individual particle positions are not reproducible** in multi-particle runs. Assert on hand-computable single-particle results, on invariants, or on aggregate statistics with a tolerance (`runStats`). The aggregate ranges in `simulation.test.ts` are measured values that also held before the 2026-11 refactor; if a deliberate behaviour change moves them, re-measure over several runs.
- Pure modules (`simulation-controls.ts`, `letterbox.ts`, `binGrid`, `scatter`, the particle layout) are tested without a GPU. `particle-layout.ts` still needs WebGPU's global constants, which importing `test/gpu.ts` provides.

## Architecture

`Renderer` (`src/renderer.ts`) owns the canvas and the frame loop and wires four modules together. Each frame it asks the controls for the simulation input, steps the simulation, and has the target draw and present it.

```
input-bindings.ts ─┐
                   ├─> SimulationControls ── SimulationInput ──> Verlet.step()
gui-wrapper.ts ────┘                                             Verlet.draw() <── SimulationTarget.render()
```

### Simulation controls (`src/simulation-controls.ts`)

Holds the user-adjustable settings and the click force rules, and produces a `SimulationInput` once per frame via `frameInput()`. It knows nothing about the DOM or the GPU. Two adapters drive it: `input-bindings.ts` (mouse and keyboard, via `game-inputs`) and `gui-wrapper.ts` (lil-gui, bound directly to the controls object's fields with `.listen()`, so there is one copy of the state).

### Simulation (`src/verlet/`)

`Verlet` is the interface to the simulation: `step(encoder, frameTime, input)`, `draw(pass)`, `reset()`, `readParticles()`. It owns the particle buffer, the params uniform, the substep count (20) and the projection. `VerletBinComputer` and `VerletRenderer` are internal to it.

- `step` writes the params uniform once with `queue.writeBuffer`, then encodes all substeps. The write takes effect when the encoder is submitted, so call `step` at most once per submitted encoder.
- Starting particles come from a `seed` function (default: `scatter`, a random scatter with an injectable random source). `reset()` calls it again. The particle count and the bin size are derived from the first seeding and are fixed afterwards.

**Particle layout.** All particles live in one `GPUBuffer` with `STORAGE | VERTEX` usage: the compute shaders mutate it as a storage array and the renderer reads the same buffer as a per-instance vertex buffer. The structs in `shaders/common.wgsl` are the single description of the particle and params layouts. `particle-layout.ts` parses that file with `webgpu-utils` and derives every CPU-side offset from it (packing, unpacking, the vertex buffer layout, the params uniform). To add or move a field, edit `common.wgsl` and the pack/unpack functions; nothing else holds an offset. `VerletObject` and `VerletObjectAtomicBin` must stay field-for-field identical, which a test checks. A radius of 0 marks a particle as disabled in both the collide and render shaders.

**Shader assembly.** WGSL has no imports. `shader-source.ts` is the one place compute shader source is assembled: it prepends `common.wgsl` (shared structs, plus the `params` uniform at group 0 binding 1 and `binParams` at group 1) to each shader body. Each compute shader then declares only the group 2 storage bindings it uses: `verletObjects` (0), `bins` (1), `cso` (2). The render shader `verlet-renderer.wgsl` is standalone.

**One substep** dispatches, in order:

1. `bin-clear`, `bin-link-clear`, `bin-set` — build the spatial hash
2. `apply-forces` — gravity (+y, scaled by radius), or the click force when one is active
3. `collide` then `collideIncrement`, four times
4. `constrain` — keep particles inside the boundary circle (two modes, selected by `params.constrainType`)
5. `integrate` — Verlet step, then clear `accel` and `binLink`

Step 1 and step 3 are skipped when collision is off.

**Spatial hash.** The grid uses bins as wide as the largest particle's diameter. `bins[bin]` holds the index of the head particle and each particle's `binLink` points to the next, forming a per-bin linked list terminated by -1. `bin-set` builds these lists lock-free with `atomicExchange`, which is why it views the same buffers through `VerletObjectAtomicBin` and `array<atomic<i32>>` while every other shader uses the plain types.

**Race-free collisions.** `collide` writes positions of particles in the 3x3 neighbourhood of its bin, so adjacent bins cannot be processed in parallel. Each `collide` dispatch covers only every second bin in x and y (hence the grid dimensions are forced even and the dispatch is `width/2 x height/2`), offset by `cso`. `collideIncrement` is a 1-invocation shader that advances `cso` through (0,0), (1,0), (0,1), (1,1) on the GPU, so the four passes can be encoded in a single command buffer with no CPU-side uniform writes between them. `collide` also caps work at 1000 pair tests per bin to bound frame time when many particles pile into one bin.

**Rendering.** Particles are instanced quads (`src/quad.ts` supplies vertex buffer slot 0, the particle buffer is slot 1). The fragment shader discards outside the unit circle, and the quad is scaled 1.25x the radius with additive blending so neighbouring balls overlap slightly.

### Simulation target (`src/simulation-target.ts`)

Owns the fixed-size image (3840x2160) the simulation is drawn into, both 4x multisampled passes, the presentation pipeline and the letterbox viewport. `render(encoder, canvasView, draw)` draws the scene into the image, then presents it to the canvas with its aspect ratio kept. It also supplies the projection and the `drawTarget` (format, sample count, depth format) that any pipeline drawing the simulation must match, and maps canvas pixels to simulation space for the pointer. Simulation space has its origin at the centre and y pointing down. The letterbox maths are pure functions in `letterbox.ts`.

`src/shaders/dimTexture.wgsl` is not wired in. `notes.md` describes how it plus `loadOp: 'load'` would give a motion-blur trail effect; that change belongs in this module.

### Known quirks, left as they are

- `collide.wgsl` compares `neighborIndex == 4`, a bin index, where `neighborIndexIndex == 4` (the centre bin) looks intended.
- A particle far outside the boundary circle is snapped to the edge with a large inward velocity, so shrinking the constrain radius flings particles across the circle.
- The constrain radius slider tops out at 1000, below the starting value of 1060.

## Controls

Left mouse attracts, right mouse repels. Keys: `R` reset, `C` toggle collision, `P` pause, `L` click lock (keep the force active after release), `T` toggle classic vs. reflective boundary constraint. The same settings are in the lil-gui panel.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `GhostCrab/webgpu`, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels are used unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
