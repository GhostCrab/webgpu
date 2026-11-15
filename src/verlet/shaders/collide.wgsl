// The collision solve: the Jacobi gather of ADR-0002. Each
// particle reads the particles in the 3x3 bins around its own and, for every
// one it overlaps, works out its own share of two corrections: a move that
// removes the overlap, and a change of velocity. It averages each over its
// contact count and writes only itself, to the other particle buffer, and its
// change of velocity, which the velocity update applies after the boundary.
// No invocation writes anything another one reads, so there are no data races.
//
// The sums are kept in fixed point, so they do not depend on the order the
// neighbours are visited in (ADR-0001). Every overlapping pair is resolved;
// there is no cap on the pairs tested.

@group(1) @binding(2) var<storage, read_write> binStarts: array<u32>;

// The particles in bin order, as the bin grid build left them.
@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;
// The particles after the solve, at the same places.
@group(2) @binding(1) var<storage, read_write> solved: array<Particle>;
// Per particle, at the same places: the change of velocity its contacts call
// for, which the velocity update applies after the boundary.
@group(2) @binding(2) var<storage, read_write> impacts: array<vec2<f32>>;

// One bin width, in fixed-point steps. One contact's correction is at most
// about two bin widths (a bin is the largest diameter), so a sum over more
// than a thousand contacts fits in an i32.
const FIXED_STEPS_PER_BIN = 524288.0;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= binGrid.particleCount) {
    return;
  }

  var p = particles[i];
  impacts[i] = vec2<f32>(0.0);
  if (p.radius == 0.0) {
    solved[i] = p;
    return;
  }

  let toFixed = FIXED_STEPS_PER_BIN / binGrid.binSize;
  let dt = params.deltaTime;
  // Mass is proportional to area.
  let mass = p.radius * p.radius;
  let home = vec2<i32>(binCoords(p.pos));

  // A move, and a change of velocity as a move over one substep, in fixed point.
  var shift = vec2<i32>(0);
  var impulse = vec2<i32>(0);
  var contacts = 0u;

  // Neighbouring bins in a fixed order, each bin's particles in particle id order.
  for (var dy = -1; dy <= 1; dy++) {
    let y = home.y + dy;
    if (y < 0 || y >= i32(binGrid.height)) {
      continue;
    }
    for (var dx = -1; dx <= 1; dx++) {
      let x = home.x + dx;
      if (x < 0 || x >= i32(binGrid.width)) {
        continue;
      }
      let bin = u32(y) * binGrid.width + u32(x);
      for (var j = binStarts[bin]; j < binStarts[bin + 1u]; j++) {
        if (j == i) {
          continue;
        }
        let q = particles[j];
        if (q.radius == 0.0) {
          continue;
        }
        let apart = p.pos - q.pos;
        let d2 = dot(apart, apart);
        let touching = p.radius + q.radius;
        if (d2 >= touching * touching) {
          continue;
        }

        // The contact normal, from the other particle to this one. Coincident
        // particles separate along x, the one with the lower id toward -x.
        let dist = sqrt(d2);
        var n = vec2<f32>(select(1.0, -1.0, p.id < q.id), 0.0);
        if (dist > 0.0) {
          n = apart / dist;
        }
        // This particle's share of the pair's corrections: the other's mass
        // over both, so the heavier particle moves less and the pair's
        // momentum is kept.
        let share = (q.radius * q.radius) / (mass + q.radius * q.radius);
        let overlap = touching - dist;
        shift += vec2<i32>(round(n * (overlap * share) * toFixed));

        // The pair's change of velocity, as a move over one substep. Removing
        // the overlap becomes velocity, as if derived from the position
        // change, but no faster than the speed limit, so overlapping particles
        // separate without popping apart. An impact, a closing pair, is
        // stopped however little it overlaps, then parts at the restitution's
        // fraction of its closing speed, and loses the damping's fraction of
        // its speed along the contact.
        let relative = p.vel - q.vel;
        let closing = dot(relative, n);
        let stop = max(-closing * dt, 0.0);
        let parting = max(stop, min(overlap, params.speedLimit)) +
          params.particleRestitution * stop;
        var sliding = vec2<f32>(0.0);
        if (closing < 0.0) {
          sliding = (relative - closing * n) * dt;
        }
        let dv = n * parting - params.particleDamping * sliding;
        impulse += vec2<i32>(round(dv * share * toFixed));
        contacts++;
      }
    }
  }

  if (contacts > 0u) {
    let average = 1.0 / (f32(contacts) * toFixed);
    // The move is scaled by the relaxation factor, and like any move in a
    // substep it is no longer than the speed limit.
    let correction = vec2<f32>(shift) * (average * params.relaxation);
    p.pos += limitLength(correction, params.speedLimit);
    impacts[i] = vec2<f32>(impulse) * (average / dt);
  }
  solved[i] = p;
}
