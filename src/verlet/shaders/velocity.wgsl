@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;
// Per particle, at the same places: the change of velocity the collision
// solve found its contacts call for.
@group(2) @binding(2) var<storage, read_write> impacts: array<vec2<f32>>;

// The last stage of a substep with collision on: the change of velocity the
// collision solve found for each particle, within the speed limit.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&particles)) {
    return;
  }
  let vel = particles[i].vel + impacts[i];
  particles[i].vel = limitLength(vel, params.speedLimit / params.deltaTime);
}
