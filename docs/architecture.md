# Architecture

Terms such as particle, bin, substep and simulation input are defined in `GLOSSARY.md`. The decisions behind the simulation's design are recorded in `docs/adr/`: a fixed substep and run-to-run determinism ([ADR-0001](adr/0001-run-to-run-determinism-on-a-fixed-substep.md)), the Jacobi gather collision solver ([ADR-0002](adr/0002-jacobi-gather-collision-solver.md)), the dense counting-sort bin grid ([ADR-0003](adr/0003-dense-counting-sort-bin-grid-not-a-spatial-hash.md)) and simulation space in its own units, drawn through a camera ([ADR-0004](adr/0004-simulation-space-in-its-own-units.md)).

`Renderer` (`src/renderer.ts`) owns the canvas and the frame loop and wires the other modules together. Each frame it asks the controls for the simulation input, asks the clock how many substeps the elapsed time calls for, steps the simulation by that many, and has it draw itself straight to the canvas as the camera shows it. On a resize it refits the camera to the canvas.

```
input-bindings.ts ─┐
                   ├─> SimulationControls ── SimulationInput ──┐
gui-wrapper.ts ────┘                                           ├──> Verlet.step()
   frame timestamp ──> Clock ── substeps ──────────────────────┘    Verlet.draw() <── Camera
```

## Clock (`src/clock.ts`)

A pure module that turns the time elapsed between frames into a whole number of substeps at the substep rate (ADR-0001). Elapsed time comes from the timestamp `requestAnimationFrame` passes. Time too short for a whole substep is carried into the next frame. One frame is credited with at most 1/60 s (`MAX_FRAME_TIME`); time beyond that is dropped, so after a stall or when the GPU falls behind the simulation runs slower than real time instead of lurching. `advance()` also reports the substeps the frame wanted before that limit, which the settings panel shows beside the substeps run. While paused the renderer does not advance the clock.

## Simulation controls (`src/simulation-controls.ts`)

Holds the user-adjustable settings (including the substep rate, default `DEFAULT_SUBSTEP_RATE`, and the collision settings, defaults `DEFAULT_COLLISION_SETTINGS`) and the click force rules, and produces a `SimulationInput` once per frame via `frameInput()`. It also holds the spawn settings (rate, radius, colour) and the capacity (default `DEFAULT_CAPACITY`), and the spawn rules: while the spawn key (S) is held and the simulation runs, `frameSpawn(elapsed)` returns the spawn rate's worth of particles at rest, spread over a disc of `SPAWN_SPREAD` spawn radii around the pointer, carrying part of a particle between frames and counting at most 1/60 s per frame. The renderer passes them to `Verlet.spawn` before encoding the frame's substeps; a change of capacity in the settings panel makes a new simulation. Likewise, while the erase key (E) is held and the simulation runs, `frameErase()` returns the erase region: the pointer and the erase radius, which the renderer passes to `Verlet.erase` every frame. It knows nothing about the DOM or the GPU. Two adapters drive it: `input-bindings.ts` (mouse and keyboard, via `game-inputs`) and `gui-wrapper.ts` (lil-gui, bound directly to the controls object's fields with `.listen()`, so there is one copy of the state).

## Simulation (`src/verlet/`)

`Verlet` (`verlet.ts`) is the interface to the simulation: `step(encoder, substeps, input)`, `draw(encoder, view, camera)`, `spawn(particles)`, `erase(region)`, `reset()`, `readParticles()`, `destroy()`. It validates what it is given, owns the params uniform, and holds one `SimulationPipeline` (`simulation-pipeline.ts`), which owns the particles on the GPU and encodes the passes that advance and draw them. `SimulationPipeline` uses `BinGrid` (`bin-grid.ts`) for the bin grid and `VerletRenderer` (`verlet-renderer.ts`) for drawing.

- Particles cross the interface with a position, a velocity in simulation units per second, a radius, a colour and a particle id. A seed's particles take their index as their id, and `readParticles()` returns them ordered by id.
- `SimulationInput` carries the collision settings (`CollisionSettings` in `collision.ts`, a pure module holding their defaults): the relaxation factor, and restitution and damping for particle impacts. The boundary circle keeps its own restitution and damping, as constants in `common.wgsl`.
- `step` advances by a whole number of substeps. Each covers `1 / input.substepRate` seconds; the substep rate is the only thing that sets a substep's length, and how substeps are split between calls does not change the result.
- `step` writes the params uniform once with `queue.writeBuffer`, then encodes the substeps. The write takes effect when the encoder is submitted, so call `step` at most once per submitted encoder.
- `draw` encodes a render pass that clears the canvas view to black and draws the particles into it, through the camera's projection. It writes the projection with `queue.writeBuffer`, so call it at most once per submitted encoder. The canvas format is a construction option.
- `step` takes an optional stage timer, used only by the benchmark (`bench/`). With one, each stage of a substep is encoded as its own compute pass carrying the timer's timestamp writes; without one, a substep is a single compute pass.
- The **capacity** (construction option, default `DEFAULT_CAPACITY`, in the pure module `capacity.ts`) is the most particles the simulation holds. Every per-particle buffer is allocated for it once; changing it means a new `Verlet`. It must be a whole number, 1 or more, and no more than `maxCapacity` of the device's limits allows: as many particles as one storage binding holds, and as many as one dispatch of per-particle workgroups covers (4,194,240 under WebGPU's default limits).
- Starting particles come from a `seed` function (default: `scatter`, a random scatter with an injectable random source, of 15,000 particles of radius `SEED_RADIUS`, or the capacity if smaller). `reset()` calls it again, removing every spawned particle and starting particle ids again from 0. A seed may return any number of particles up to the capacity.
- `spawn(particles)` adds particles after the live ones, with particle ids following the highest given so far, until the capacity is reached; the rest are dropped, and it returns how many were added. Every spawned radius must be more than 0 and keep the largest radius in use at most `MAX_RADIUS_RATIO` times the smallest; a seed's enabled radii are held to the same ratio. It stages the particles in the other particle and colour buffers and submits its own small pass, which copies them after the live ones wherever those end and raises the live count; it takes effect at once, not at a substep number, so call it between submitted encoders, never between `step` and submitting its encoder.
- `erase(region)` submits its own pass, which marks the live particles whose centres are within the region's `radius` of its `center` erased (a radius below 0); the next bin grid build leaves them out, so an erased particle costs nothing afterwards. Like `spawn` it takes effect at once and is called between submitted encoders. It returns a promise of how many it erased, read back without anything waiting for it, or 0 if the simulation is destroyed first; erases are not reproducible, and the particle ids of the survivors never change.
- Only the live particles, the first of the particle buffer, are simulated, drawn and read back. The GPU keeps their count, in the live particles buffer (`LiveParticles` in `common.wgsl`, bound read-only to every stage as `live`): each bin grid build sets it to the particles it placed, and spawning raises it. The same buffer holds the arguments of an indirect dispatch over the live particles, which every per-particle dispatch uses, and of the indirect draw, so no frame waits on a readback.
- The CPU keeps an upper bound on the live count, `particleCount`: particles seeded and spawned, less each erase once its count has been read back and a substep (and so a bin grid build) has been encoded after it. Spawning keeps within the capacity by that bound, so it never exceeds the capacity, and erased particles make room once they are counted out. `reset()` makes it exact again.
- The speed limit is the smallest radius seeded or spawned since the last seeding, and the bins are sized for the largest.
- `encodeBinGridBuild` and `readBinGrid` run one bin grid build on its own and read back what it left. They exist for the bin grid's tests.

### Determinism

A scene run twice on the same machine and browser, with no user input, gives identical particles (ADR-0001). Every pass writes only its own particle, and nothing depends on the order atomic operations complete in: the bin grid's atomic counts decide only where an id is listed, never where a particle is placed, and the collision solve sums its corrections in fixed point. The same scene on another GPU or browser gives different particles, since floating-point results differ between them.

### Particle layout

The particles live in two `GPUBuffer`s with `STORAGE | VERTEX` usage: the compute shaders mutate them as storage arrays and the renderer reads the one holding the particles as a per-instance vertex buffer (see the bin grid, below, for why there are two).

The structs in `shaders/common.wgsl` are the single description of the particle, params and bin grid layouts. `particle-layout.ts` parses that file with `webgpu-utils` and derives every CPU-side offset from it: packing, unpacking, the vertex buffer layout and the uniforms. To add or move a field, edit `common.wgsl` and the pack/unpack functions; nothing else holds an offset.

- A `Particle` holds position, velocity (in simulation units per second), radius and particle id, in 24 bytes.
- Its colour is in a separate colour buffer, one `rgba8` word per particle at the same place as the particle. There are two colour buffers: each bin grid build moves the colours to the other with the particles, so colour follows a particle wherever it sits in memory. Only the build and drawing read them. (Colour was once indexed by particle id; particle ids only increase, and with erasing they pass the capacity.)
- Readback sorts by particle id.

A radius of 0 marks a particle as disabled: it is not drawn, and it does not collide. A radius below 0 marks it erased: it is not drawn, and the next bin grid build leaves it out.

### Shader assembly

WGSL has no imports. `shader-source.ts` is the one place compute shader source is assembled: it prepends `common.wgsl` (the shared structs, the `params` uniform at group 0 binding 1 and the `binGrid` uniform at group 1 binding 1) to each shader body. `common.wgsl` also holds `PARTICLE_WORKGROUP_SIZE`, the workgroup size of every per-particle dispatch, which `particle-layout.ts` reads from it, `binCoords` and `binIndex` (the bin a position falls in), `constrainToBoundary` (the boundary stage) and `limitLength` (the speed limit).

Each compute shader then declares only the storage bindings it uses: the particles at group 2, binding 0; in the bin grid build and in spawn and erase (`edit.wgsl`), the other particle buffer at binding 1 and the two colour buffers at bindings 3 and 4; in the collision solve, `solved` at binding 1 and `impacts` at binding 2, which the velocity update also reads. The bin grid's buffers are group 1, bindings 2 to 4, and the live particles binding 5; stages other than the build bind only the bin starts and the live particles there, so no stage binds more than the default 8 storage buffers. Spawn and erase take their uniform and erase count at group 3. The bin grid scan binds its own storage at group 0, bindings 2 and 3, so no dispatch binds the bin starts twice; `live-count.wgsl`, which alone writes the live count, binds the bin starts, the live particles and the spawn's uniform at group 0.

The render shader, `particle-disc.wgsl`, stands alone.

### One substep

Dispatched by `SimulationPipeline.encodeSubstep` in this order, the order spec #9 fixes:

1. `integrate.wgsl` adds gravity (3000 units per second squared along +y, the same for every particle whatever its radius) or the click force (1.5 units per second squared per unit of force) to velocity, applies the speed limit to velocity, then advances position. A particle exactly at the click point receives no click force.
2. The bin grid build (below), which leaves the particles in bin order in the other particle buffer. It runs every substep, whether or not collision is on.
3. `collide.wgsl`, the collision solve (below). It reads the particles in bin order and writes them back to the first particle buffer, with each particle's change of velocity in the impact buffer.
4. `constrain.wgsl` applies the selected constrain, so no substep ends with a particle outside the boundary circle. A particle past the circle is placed back on it, keeping its own velocity rather than one derived from the distance moved, so a particle far outside returns without being flung across. Two modes, selected by `params.constrainType`: the classic constrain removes outward velocity and damps the rest by 0.95; the reflective constrain reflects velocity only when the particle is moving outward, keeping 0.8 of the normal component and all of the tangential one. Both use `params.constrainCenter`.
5. `velocity.wgsl`, the velocity update, adds each particle's change of velocity from the solve and applies the speed limit.

With `collide` off, steps 3 and 5 are skipped; the bin grid is still built. With a stage timer the stages are named `integrate`, `bin count`, `bin scan`, `bin place`, `collide`, `constrain` and `velocity`.

The speed limit (`params.speedLimit`) is the smallest radius in use (seeded or spawned since the last seeding) per substep. It keeps particles from passing through each other and from leaving the bin grid at speed.

### Collision solve

The Jacobi gather of ADR-0002 (`collide.wgsl`). One invocation per particle reads the particles in the 3x3 bins around its own, from `binStarts`, visiting bins in a fixed order and each bin's particles in particle id order. Every overlapping pair is resolved; there is no cap on pair tests. For each contact it takes its own share of two corrections, the other particle's mass over both (mass is proportional to radius squared), so a pair's momentum is kept:

- **A move** that removes the overlap. The moves are averaged over the contact count, scaled by the relaxation factor (`params.relaxation`) and limited to the speed limit, and the result moves the particle.
- **A change of velocity.** Removing the overlap becomes velocity, as if derived from the position change, but no faster than the speed limit, so overlapping particles separate without popping apart. A closing pair (an impact) is stopped however little it overlaps, then parts at `params.particleRestitution` of its closing speed and loses `params.particleDamping` of its speed along the contact. These are averaged over the contact count, not relaxed, and held in the impact buffer until the velocity update applies them after the boundary.

Both sums are kept in fixed point (`2^19` steps per bin width), so they do not depend on the order neighbours are visited in (ADR-0001). Coincident particles separate along x, the lower particle id toward -x. A disabled particle neither moves others nor is moved. The solve writes every particle to the other particle buffer at the same place, so no invocation writes what another reads.

### Bin grid

`BinGrid` (`bin-grid.ts`, shaders `bin-grid.wgsl` and `bin-scan.wgsl`) is a dense grid of square bins over the square of side `bounds`, rebuilt every substep by counting sort (ADR-0003). It is not a hash table.

- **Sizing** is the pure function `sizeBinGrid`: a bin is one diameter of the largest particle in use wide, never smaller than the configured minimum bin size (the `minBinSize` construction option, by default the largest diameter of the first seeding). The grid covers the bounds, so the last row and column may be part-filled; the bin size need not be a whole number. Bin buffers are allocated once, for the minimum bin size and the capacity; `write` (and so `reset`) resizes the bins for the new particles' largest radius, and `append` (and so `spawn`) for the largest radius spawned so far.
- **Bin coordinates** are clamped into the grid (`binCoords` in `common.wgsl`), so a particle outside the grid, or with a non-finite position, is placed in an edge bin.
- **The build:** `clearBins` and `countBins` count the particles in each bin; a blocked exclusive prefix sum turns the counts into each bin's start; `writeKeys` lists each bin's particle ids in its run of `binKeys`; `placeParticles` copies each particle, and its colour, to its bin's start plus its rank by particle id among that bin's ids; `countPlaced` sets the live count to the number placed. Erased particles are not counted, listed or placed, so the build compacts them away. Afterwards bin `b`'s particles are `binStarts[b]` up to `binStarts[b + 1]`, in particle id order. The atomic counts decide only where an id is listed, never where a particle is placed, so the order is fixed at build time and never depends on thread timing (ADR-0001). Ranking costs each particle one read per particle in its bin.
- **The scan** works in blocks of 256: each workgroup scans its block in workgroup memory and writes the block's total to the level above; levels repeat until one block holds every total (three levels above the counts for 4.7 million bins), then each level's scanned totals are added back into the level below. Its work is linear in the number of bins. A grid is limited to `MAX_BINS` (about 16.7 million), so every dispatch over bins fits in one dimension.
- **Two particle buffers:** each build reads the particles from one and writes them in bin order to the other, which then holds the particles; the collision solve writes them back. `SimulationPipeline` tracks which buffer holds them as it encodes, and draws and reads back from it. The colours move with them between their own two buffers, so colour follows each particle. Between substeps the other buffers are free, and spawning stages new particles there.
- **For the collision solve:** the bin grid's bind group (group 1) holds the grid uniform `binGrid` (binding 1) and `binStarts` (binding 2); the particles in bin order are group 2, binding 0, for every stage encoded after the build.

### Rendering

Particles are instanced quads drawn straight to the canvas, at its resolution, by `VerletRenderer` (`src/quad.ts` supplies vertex buffer slot 0, the particle buffer is slot 1). The vertex shader maps simulation space to clip space with the camera's projection, and reads each particle's colour from the colour buffer at its instance index, the particle's place. It draws one instance per live particle, from the indirect draw arguments the GPU keeps. The quad is scaled 1.25x the radius with additive blending, so neighbouring balls overlap slightly. There is no multisampling and no depth or stencil attachment: the fragment shader smooths each disc's edge, fading it out over the last pixel inside the edge, and discards outside it.

## Camera (`src/camera.ts`)

Pure functions that fit simulation space to the canvas (ADR-0004). Simulation space is measured in its own units and sized by the boundary circle's starting radius alone: `simulationSize(radius)` is the side of the square, centred on the origin, that holds the circle with a margin of 1/53 of the radius on each side (2160 units for the starting radius, `STARTING_BOUNDARY_RADIUS`, 1060). The renderer passes that size to `Verlet` as its bounds and to the camera. No image is sized from it.

- `fitCamera(size, canvasWidth, canvasHeight)` fits the square to the canvas with its proportions kept: it fills the canvas's shorter side, and a canvas of another shape shows more of simulation space along its longer side. A canvas with no area gives a scale of 0, and the renderer then draws nothing.
- `canvasToSimulation` maps a pointer position in canvas pixels to simulation space, and `simulationToCanvas` is its inverse. Simulation space has its origin at the canvas's centre and y pointing down, so a click lands at the same point in simulation space at any window size.
- `cameraProjection` is the matrix `Verlet.draw` uses to take simulation space to clip space.

An effect that needs the previous frame's image, such as a motion-blur trail, would need an offscreen image again; none exists.
