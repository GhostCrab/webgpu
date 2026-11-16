@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;

// The boundary stage of a substep: the selected constrain, so that no substep
// ends with a particle outside the boundary circle.
@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= live.count) {
    return;
  }

  let c = constrainToBoundary(particles[i].pos, particles[i].vel, particles[i].radius);
  if (!c.moved) {
    return;
  }
  particles[i].pos = c.pos;
  particles[i].vel = c.velocity;
}
