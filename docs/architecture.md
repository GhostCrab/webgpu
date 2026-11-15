# Architecture

Terms such as particle, bin, substep and simulation input are defined in `GLOSSARY.md`. The shader structs keep the older name `VerletObject` for a particle.

`Renderer` (`src/renderer.ts`) owns the canvas and the frame loop and wires the other modules together. Each frame it asks the controls for the simulation input, asks the clock how many substeps the elapsed time calls for, steps the simulation by that many, and has the target draw and present it.

```
input-bindings.ts ─┐
                   ├─> SimulationControls ── SimulationInput ──┐
gui-wrapper.ts ────┘                                           ├──> Verlet.step()
   frame timestamp ──> Clock ── substeps ──────────────────────┘    Verlet.draw() <── SimulationTarget.render()
```

## Clock (`src/clock.ts`)

A pure module that turns the time elapsed between frames into a whole number of substeps at the substep rate (ADR-0001). Elapsed time comes from the timestamp `requestAnimationFrame` passes. Time too short for a whole substep is carried into the next frame. One frame is credited with at most 1/60 s (`MAX_FRAME_TIME`); time beyond that is dropped, so after a stall or when the GPU falls behind the simulation runs slower than real time instead of lurching. `advance()` also reports the substeps the frame wanted before that limit, which the settings panel shows beside the substeps run. While paused the renderer does not advance the clock.

## Simulation controls (`src/simulation-controls.ts`)

Holds the user-adjustable settings (including the substep rate, default 1200 per second) and the click force rules, and produces a `SimulationInput` once per frame via `frameInput()`. It knows nothing about the DOM or the GPU. Two adapters drive it: `input-bindings.ts` (mouse and keyboard, via `game-inputs`) and `gui-wrapper.ts` (lil-gui, bound directly to the controls object's fields with `.listen()`, so there is one copy of the state).

## Simulation (`src/verlet/`)

`Verlet` is the interface to the simulation: `step(encoder, substeps, input)`, `draw(pass)`, `reset()`, `readParticles()`, `destroy()`. It owns the particle buffer, the params uniform and the projection. `VerletBinComputer` and `VerletRenderer` are internal to it.

- `step` advances by a whole number of substeps. Each covers `1 / input.substepRate` seconds; the substep rate is the only thing that sets a substep's length, and how substeps are split between calls does not change the result.
- `step` writes the params uniform once with `queue.writeBuffer`, then encodes the substeps. The write takes effect when the encoder is submitted, so call `step` at most once per submitted encoder.
- The physics is still position Verlet, so velocity is held as a displacement per substep. Changing the substep rate while running therefore rescales every particle's velocity at that moment, until the explicit velocity of the new pipeline replaces it.
- Starting particles come from a `seed` function (default: `scatter`, a random scatter with an injectable random source, its starting velocities scaled to the latest substep rate). `reset()` calls it again. The particle count and the bin size are derived from the first seeding and are fixed afterwards.

### Particle layout

All particles live in one `GPUBuffer` with `STORAGE | VERTEX` usage: the compute shaders mutate it as a storage array and the renderer reads the same buffer as a per-instance vertex buffer.

The structs in `shaders/common.wgsl` are the single description of the particle and params layouts. `particle-layout.ts` parses that file with `webgpu-utils` and derives every CPU-side offset from it: packing, unpacking, the vertex buffer layout and the params uniform. To add or move a field, edit `common.wgsl` and the pack/unpack functions; nothing else holds an offset.

`VerletObject` and `VerletObjectAtomicBin` must stay field-for-field identical, which a test checks. A radius of 0 marks a particle as disabled in both the collide and render shaders.

### Shader assembly

WGSL has no imports. `shader-source.ts` is the one place compute shader source is assembled: it prepends `common.wgsl` (shared structs, plus the `params` uniform at group 0 binding 1 and `binParams` at group 1) to each shader body. Each compute shader then declares only the group 2 storage bindings it uses: `verletObjects` (0), `bins` (1), `cso` (2). The render shader `verlet-renderer.wgsl` is standalone.

### One substep

Dispatched in this order:

1. `bin-clear`, `bin-link-clear`, `bin-set` build the bin grid.
2. `apply-forces` applies gravity (+y, scaled by radius), or the click force when one is active.
3. `collide` then `collideIncrement`, four times.
4. `constrain` keeps particles inside the boundary circle (two modes, selected by `params.constrainType`).
5. `integrate` takes the Verlet step, then clears `accel` and `binLink`.

Steps 1 and 3 are skipped when collision is off.

### Bin grid

A dense grid over simulation space, not a hash table. The grid uses bins as wide as the largest particle's diameter. `bins[bin]` holds the index of the head particle and each particle's `binLink` points to the next, forming a per-bin linked list terminated by -1.

`bin-set` builds these lists lock-free with `atomicExchange`, which is why it views the same buffers through `VerletObjectAtomicBin` and `array<atomic<i32>>` while every other shader uses the plain types.

### Four-pass collisions

`collide` writes positions of particles in the 3x3 neighbourhood of its bin, so adjacent bins cannot be processed in parallel. Each `collide` dispatch covers only every second bin in x and y (hence the grid dimensions are forced even and the dispatch is `width/2 x height/2`), offset by `cso`.

**This scheme races.** Two invocations two bins apart both write the particles in the bin between them, without synchronisation. This was found by reading the shader and has not been demonstrated by a test. `docs/adr/0002-jacobi-gather-collision-solver.md` records the replacement; until it lands, treat lost corrections as a second source of run-to-run differences.

`collideIncrement` is a 1-invocation shader that advances `cso` through (0,0), (1,0), (0,1), (1,1) on the GPU, so the four passes can be encoded in a single command buffer with no CPU-side uniform writes between them.

`collide` also caps work at 1000 pair tests per bin to bound frame time when many particles pile into one bin.

### Rendering

Particles are instanced quads (`src/quad.ts` supplies vertex buffer slot 0, the particle buffer is slot 1). The fragment shader discards outside the unit circle, and the quad is scaled 1.25x the radius with additive blending so neighbouring balls overlap slightly.

## Simulation target (`src/simulation-target.ts`)

Owns the fixed-size image (3840x2160) the simulation is drawn into, both 4x multisampled passes, the presentation pipeline and the letterbox viewport.

- `render(encoder, canvasView, draw)` draws the scene into the image, then presents it to the canvas with its aspect ratio kept.
- It supplies the projection and the `drawTarget` (format, sample count, depth format) that any pipeline drawing the simulation must match.
- It maps canvas pixels to simulation space for the pointer. Simulation space has its origin at the centre and y pointing down. The letterbox maths are pure functions in `letterbox.ts`.

`src/shaders/dimTexture.wgsl` is not wired in. `notes.md` describes how it plus `loadOp: 'load'` would give a motion-blur trail effect; that change belongs in this module.
