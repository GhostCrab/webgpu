# Architecture

Terms such as particle, bin, substep and simulation input are defined in `GLOSSARY.md`. The current pipeline's shader struct keeps the older name `VerletObject` for a particle.

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

`Verlet` is the interface to the simulation: `step(encoder, substeps, input)`, `draw(pass)`, `reset()`, `readParticles()`, `destroy()`. It owns the params uniform and one **pipeline**, which owns the particles and advances and draws them.

While spec #9's new pipeline is built beside the current one, the `pipeline` construction option selects `'current'` (the default) or `'new'`. Both implement the internal `Pipeline` interface (`pipeline.ts`): `CurrentPipeline` (`current-pipeline.ts`, with `VerletBinComputer`) and `CompactPipeline` (`compact-pipeline.ts`). Both draw through `VerletRenderer`. The app runs the current pipeline unless the page URL has `?pipeline=new`.

- Particles cross the interface with a position, a velocity in simulation units per second, a radius, a colour and a particle id. A seed's particles take their index as their id, and `readParticles()` returns them ordered by id.

- `step` advances by a whole number of substeps. Each covers `1 / input.substepRate` seconds; the substep rate is the only thing that sets a substep's length, and how substeps are split between calls does not change the result.
- `step` writes the params uniform once with `queue.writeBuffer`, then encodes the substeps. The write takes effect when the encoder is submitted, so call `step` at most once per submitted encoder.
- The current pipeline's physics is position Verlet, so it holds velocity as a displacement per substep, converting at the interface at the latest substep rate. Changing the substep rate while running therefore rescales every particle's velocity at that moment. The new pipeline holds velocity explicitly.
- Starting particles come from a `seed` function (default: `scatter`, a random scatter with an injectable random source). `reset()` calls it again. The particle count and the bin size are derived from the first seeding and are fixed afterwards.

### Particle layout

In each pipeline all particles live in one `GPUBuffer` with `STORAGE | VERTEX` usage: the compute shaders mutate it as a storage array and the renderer reads the same buffer as a per-instance vertex buffer.

The structs in `shaders/common.wgsl` are the single description of the particle and params layouts. `particle-layout.ts` parses that file with `webgpu-utils` and derives every CPU-side offset from it: packing, unpacking, the vertex buffer layouts and the params uniform. To add or move a field, edit `common.wgsl` and the pack/unpack functions; nothing else holds an offset.

- The current pipeline's `VerletObject` holds position, previous position, acceleration, colour and radius, and a bin link, in 80 bytes. A particle's id is its index. `VerletObject` and `VerletObjectAtomicBin` must stay field-for-field identical, which a test checks.
- The new pipeline's `Particle` holds position, velocity, radius and particle id, in 24 bytes. Its colour is in a separate colour buffer, one `rgba8` word per particle at its particle id, which only drawing reads; so colour follows a particle wherever it sits in memory. Readback sorts by particle id.

A radius of 0 marks a particle as disabled: it is not drawn, and in the current pipeline it does not collide.

### Shader assembly

WGSL has no imports. `shader-source.ts` is the one place compute shader source is assembled: it prepends `common.wgsl` (shared structs, plus the `params` uniform at group 0 binding 1 and `binParams` at group 1) to each shader body. `common.wgsl` also holds what both pipelines compute alike: `constrainToBoundary` (the boundary stage) and `limitLength` (the speed limit). Each compute shader then declares only the group 2 storage bindings it uses: in the current pipeline `verletObjects` (0), `bins` (1), `cso` (2); in the new pipeline `particles` (0).

`VerletRenderer` assembles the render shader from `particle-disc.wgsl` (the projection and the fragment shader) followed by the pipeline's vertex shader, `verlet-renderer.wgsl` or `compact-renderer.wgsl`.

### One substep (current pipeline)

Dispatched in this order:

1. `bin-clear`, `bin-link-clear`, `bin-set` build the bin grid.
2. `apply-forces` applies gravity (+y, scaled by radius), or the click force when one is active. A particle exactly at the click point receives no click force.
3. `collide` then `collideIncrement`, four times. Coincident particles separate along x.
4. `integrate` takes the Verlet step, shortened to the speed limit (`params.speedLimit`, the smallest radius among the seeded particles), then clears `accel` and `binLink`.
5. `constrain` places any particle past the boundary circle back on it, so no substep ends with a particle outside. Two modes, selected by `params.constrainType`: the classic constrain removes outward velocity and damps the rest by 0.95; the reflective constrain reflects velocity only when the particle is moving outward, keeping 0.8 of the normal component and all of the tangential one. Both keep the particle's own velocity rather than deriving it from the distance moved, and both use `params.constrainCenter`.

Steps 1 and 3 are skipped when collision is off.

### One substep (new pipeline)

The new pipeline has no collisions yet, so the `collide` input has no effect on it. Dispatched in this order:

1. `compact-integrate` adds gravity (3000 units per second squared along +y, the same for every particle whatever its radius) or the click force (1.5 units per second squared per unit of force) to velocity, applies the speed limit to velocity, then advances position. A particle exactly at the click point receives no click force. Both constants equal what the current pipeline gives a particle of the app's radius, 1.5.
2. `compact-constrain` applies the selected constrain, as in the current pipeline.

Spec #9 fixes the order the remaining stages join in: the bin grid build and the collision solve go between these two, and the velocity update after the boundary.

### Bin grid

A dense grid over simulation space, not a hash table. The grid uses bins as wide as the largest particle's diameter. `bins[bin]` holds the index of the head particle and each particle's `binLink` points to the next, forming a per-bin linked list terminated by -1. A particle outside the grid is put in the nearest edge bin.

`bin-set` builds these lists lock-free with `atomicExchange`, which is why it views the same buffers through `VerletObjectAtomicBin` and `array<atomic<i32>>` while every other shader uses the plain types.

### Four-pass collisions

`collide` writes positions of particles in the 3x3 neighbourhood of its bin, so adjacent bins cannot be processed in parallel. Each `collide` dispatch covers only every second bin in x and y (hence the grid dimensions are forced even and the dispatch is `width/2 x height/2`), offset by `cso`.

**This scheme races.** Two invocations two bins apart both write the particles in the bin between them, without synchronisation. This was found by reading the shader and has not been demonstrated by a test. `docs/adr/0002-jacobi-gather-collision-solver.md` records the replacement; until it lands, treat lost corrections as a second source of run-to-run differences.

`collideIncrement` is a 1-invocation shader that advances `cso` through (0,0), (1,0), (0,1), (1,1) on the GPU, so the four passes can be encoded in a single command buffer with no CPU-side uniform writes between them.

`collide` also caps work at 1000 pair tests per bin to bound frame time when many particles pile into one bin.

### Rendering

Particles are instanced quads (`src/quad.ts` supplies vertex buffer slot 0, the particle buffer is slot 1). The new pipeline's vertex shader reads each particle's colour from the colour buffer by particle id. The fragment shader discards outside the unit circle, and the quad is scaled 1.25x the radius with additive blending so neighbouring balls overlap slightly.

## Simulation target (`src/simulation-target.ts`)

Owns the fixed-size image (3840x2160) the simulation is drawn into, both 4x multisampled passes, the presentation pipeline and the letterbox viewport.

- `render(encoder, canvasView, draw)` draws the scene into the image, then presents it to the canvas with its aspect ratio kept.
- It supplies the projection and the `drawTarget` (format, sample count, depth format) that any pipeline drawing the simulation must match.
- It maps canvas pixels to simulation space for the pointer. Simulation space has its origin at the centre and y pointing down. The letterbox maths are pure functions in `letterbox.ts`.

`src/shaders/dimTexture.wgsl` is not wired in. `notes.md` describes how it plus `loadOp: 'load'` would give a motion-blur trail effect; that change belongs in this module.
