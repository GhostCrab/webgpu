# Dense counting-sort bin grid, not a spatial hash

The bin grid is a dense grid over simulation space, built by counting sort: count particles per bin, prefix-sum the counts, then rewrite the particle buffer in bin order. We chose this for 500k to 1M particles because each bin's particles become one contiguous run, and because rewriting the buffer also drops erased particles for free.

## Considered Options

- **Spatial hash table.** Rejected: hashing exists to handle an unbounded domain. Simulation space is bounded by the boundary circle, so a hash would add false-positive neighbours and lose the adjacency of neighbouring bins for no gain. Revisit only if simulation space stops being bounded.
- **Per-bin linked lists** (the earlier design). Simplest to build, but every neighbour read chases a pointer, and list order depends on thread timing, which conflicts with ADR-0001.
- **Multi-level grid for mixed radii.** Rejected for now; the ratio of largest to smallest radius is limited to 4 so one grid is adequate.

## Consequences

- A particle's index in the buffer changes on every build. Anything that follows a particle (tests, colour, readback) must use its particle id.
- Bin size follows the largest radius the app has spawned or assigned. Bin buffers are allocated once, for the smallest bin size configured.
- The grid is rebuilt every substep. Rebuilding less often with a margin is a known optimisation, to be adopted only with benchmark numbers behind it.
