# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GPU-driven 2D Verlet particle simulation (15,000 colliding balls) running in WebGPU compute shaders. It was forked from the `webgpu-seed` hello-triangle template, so `readme.md`, `package.json` metadata, `.travis.yml`, and the "webgpu-seed" strings in `webpack.ts` describe the upstream template, not this project.

## Commands

```bash
npm install
npm run dev         # webpack --watch (development) + http-server, together
npm run prod        # same, minified
npm run prod-build  # one-off production build, no server
npm run serve       # http-server only
```

- Open `http://localhost:8080`. `index.html` lives at the repo root and loads `dist/main.js`; there is no dev-server reload, so refresh the page after webpack rebuilds.
- There is no `build` script, although `npm start` and `.travis.yml` both call `npm run build`. Use `npm run dev` or `npm run prod-build`.
- There are no tests and no linter. Formatting is Prettier (`.prettierrc`: 2 spaces, single quotes, semicolons, no trailing commas).
- The build is `ts-node webpack.ts`, a script that drives the webpack Node API directly (there is no `webpack.config.*`). `ts-loader` runs with `transpileOnly: true`, so **the build never reports type errors**. Run `npx tsc --noEmit` to type-check.
- `.gitignore` ignores `*.js` and `*.sh` everywhere (except `webpack.*`), so new files with those extensions will not be tracked.
- A WebGPU-capable browser is required. `lil-gui` is loaded from a CDN `<script>` tag in `index.html` and used as the global `lil`; it is not an npm dependency.

## Architecture

### Frame loop (`src/renderer.ts`)

`Renderer.render()` is an async `do/while` loop that awaits `requestAnimationFrame`. Each frame builds one command encoder:

1. Write the `simParams` uniform, with `deltaTime` already divided by `stepCount` (20).
2. Run `verlet.compute()` `stepCount` times. Each call is a separate compute pass, and all substeps of a frame share the single uniform write from step 1.
3. Render particles into `renderTexture` at the fixed simulation resolution (3840x2160).
4. Draw `renderTexture` to the canvas as a fullscreen quad, with viewport and scissor set to letterbox or pillarbox it.

Simulation space is fixed and independent of the canvas size. The origin is at the centre and y points down (the ortho matrix flips y, so "gravity" is +y). Mouse coordinates are mapped from the window through the letterbox viewport into simulation space. Only the display pass descriptor is rebuilt on resize.

`RenderPassDescriptor` owns 4x MSAA colour and depth-stencil textures, and the real target is set each frame with `updateResolveTarget()`. Every render pipeline therefore needs `multisample.count: 4` and a `depth24plus-stencil8` depth-stencil state, even when it does not use depth.

### Particle data (`src/verlet/verlet.ts`)

All particles live in one `GPUBuffer` with `STORAGE | VERTEX` usage: the compute shaders mutate it as a storage array and the renderer reads the same buffer as a per-instance vertex buffer. Each particle is 20 floats (80 bytes):

| Floats | Field |
| --- | --- |
| 0-3 | `pos` |
| 4-7 | `prevPos` |
| 8-11 | `accel` |
| 12-15 | `colorAndRadius` (rgb + radius in `.w`) |
| 16-19 | `binLink` (i32) + 3 unused |

This layout is duplicated by hand and must be changed in all of these together:

- `dataNumFloats` and the index offsets in `Verlet`'s constructor and `reset()`
- the `VerletObject` and `VerletObjectAtomicBin` structs in `src/verlet/shaders/verlet-computer-shader-header.ts`
- `arrayStride` and attribute offsets in `VerletRenderer.getBufferDescription()`

The same applies to the 16-float `simParams` array in `renderer.ts` and the `Params` struct in the shader header. `clickPoint.z` carries the mouse force (positive attracts, negative repels), and a radius of 0 marks a particle as disabled in both the collide and render shaders.

### Compute pipeline (`src/verlet/verlet-bin-computer.ts`)

Compute `.wgsl` files are not standalone. Webpack imports them as strings and `computeShaderHeader()` is prepended to each one, supplying the shared structs and the `params` (group 0, binding 1) and `binParams` (group 1) uniforms. Each file then declares only the group 2 storage bindings it uses: `verletObjects` (0), `bins` (1), `cso` (2). All compute pipelines share one explicit pipeline layout:

- group 0: global uniforms from `Renderer` (mvp + params), also used by the particle render pipeline
- group 1: bin parameters
- group 2: storage buffers

One substep dispatches, in order:

1. `bin-clear`, `bin-link-clear`, `bin-set` — build the spatial hash
2. `apply-forces` — gravity, or the mouse force when one is active
3. `collide` then `collideIncrement`, four times
4. `constrain` — keep particles inside the circle (two modes, selected by `params.constrainType`)
5. `integrate` — Verlet step, then clear `accel` and `binLink`

Step 1 and step 3 are skipped when collision is toggled off.

**Spatial hash.** The grid uses cells of `2 * maxRadius`. `bins[cell]` holds the index of the head particle and each particle's `binLink` points to the next, forming a per-cell linked list terminated by -1. `bin-set` builds these lists lock-free with `atomicExchange`, which is why it views the same buffers through `VerletObjectAtomicBin` and `array<atomic<i32>>` while every other shader uses the plain types.

**Race-free collisions.** `collide` writes positions of particles in the 3x3 neighbourhood of its cell, so adjacent cells cannot be processed in parallel. Each `collide` dispatch covers only every second cell in x and y (hence the grid dimensions are forced even and the dispatch is `width/2 x height/2`), offset by `cso`. `collideIncrement` is a 1-invocation shader that advances `cso` through (0,0), (1,0), (0,1), (1,1) on the GPU, so the four passes can be encoded in a single command buffer with no CPU-side uniform writes between them. `collide` also caps work at 1000 pair tests per cell to bound frame time when many particles pile into one cell.

Because the cell size is derived from `maxRadius`, raising `maxRadius` in `Verlet` changes the grid resolution, and particle counts are fixed at construction (`objectCount`).

### Rendering (`src/verlet/verlet-renderer.ts`)

Particles are instanced quads (`src/quad.ts` supplies vertex buffer slot 0, the particle buffer is slot 1). The fragment shader discards outside the unit circle, and the quad is scaled 1.25x the radius with additive blending so neighbouring balls overlap slightly.

### Unused code

`src/renderStats.ts` and `src/shaders/dimTexture.wgsl` are not wired in. `notes.md` describes how `dimTexture` plus `loadOp: 'load'` would give a motion-blur trail effect.

## Controls

Left mouse attracts, right mouse repels. Keys: `R` reset, `C` toggle collision, `P` pause, `L` click lock (keep the force active after release), `T` toggle classic vs. reflective boundary constraint. The same toggles are mirrored in the lil-gui panel (`src/gui-wrapper.ts`).

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `GhostCrab/webgpu`, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels are used unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
