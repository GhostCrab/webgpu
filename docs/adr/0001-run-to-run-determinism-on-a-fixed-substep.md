# Run-to-run determinism on a fixed substep

The simulation must give identical results, particle by particle, when the same scene runs twice on the same machine and browser with no user input. We chose this over raw efficiency because it lets tests and benchmarks compare algorithm changes exactly; stability and determinism rank above speed.

To get it, a substep always covers the same span of simulated time. The substep rate is a setting, and a frame runs as many substeps as the elapsed time needs, up to 1/60 s of simulated time per frame; past that the simulation runs slower than real time. The solver must also be free of data races and must visit each particle's neighbours in an order that does not depend on thread timing.

## Considered Options

- **Let the substep length follow the frame time**, so the simulation uses whatever the machine can give. Rejected: the length of a step is part of the physics, so piles would be stiffer or looser depending on load, and no two runs would match.
- **Identical results across different GPUs.** Rejected: GPUs round `sqrt` and fused multiplies differently and WGSL gives no control over it.
- **Reproducible user input** (recording clicks, spawns and erases against substep numbers). Rejected as scaffolding we don't want; runs with input are not expected to match.

## Consequences

- Tests may assert that two runs of one scene are identical, but must not store exact positions as baselines, since those differ between machines.
- The collision solve sums each particle's corrections in fixed point, so the sum does not depend on the order its neighbours are visited in (spec #9, decided on the prototype in #14, which measured no cost for it). Each bin's particles are also kept in particle id order and visited in a fixed order; that ordering is now redundant for determinism and may be dropped if the benchmark shows it is costly.
- Raising the substep rate changes the simulation's results. That is deliberate: it is a quality setting, not a performance knob to vary per frame.
