# Jacobi gather collision solver

Collisions are resolved per particle: each particle reads its neighbours from one buffer, sums its own corrections, averages them over its contact count, and writes only itself to a second buffer. We chose this over the earlier scheme, in which each bin's invocation moved particles in neighbouring bins, because that scheme raced (invocations two bins apart both wrote the bin between them) and its work scaled with the area of the bin grid instead of the particle count.

## Considered Options

- **Coloured Gauss-Seidel over bins.** Race-free only with nine passes, not four, and still dependent on the order of particles inside a bin, which conflicts with ADR-0001. Its advantage is faster convergence per substep.
- **Disjoint 2x2 bin blocks per invocation.** Fewer passes than nine colours, but an untested construction with the same order dependence.

## Consequences

- Corrections spread one particle per substep, so piles are softer per substep than under Gauss-Seidel. The substep rate and the relaxation factor are chosen by measuring residual overlap and leftover kinetic energy in a settled pile, not by eye.
- Particle data is double-buffered.
- The corrections are summed in fixed point before averaging, so the result is independent of the order neighbours are visited in (ADR-0001).
- The defaults, relaxation factor 1.25 at 2400 substeps per second, were chosen from the prototype's measurements (#14): 1.25 was the only factor stable at every substep rate measured, and 2400 per second matches the residual overlap of the earlier solver at 1200.
