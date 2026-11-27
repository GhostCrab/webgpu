@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;

// The boundary stage of a substep: the selected constrain, so that no substep
// ends with a particle outside the boundary circle.
@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= live.count) {
    return;
  }

  var pos = particles[i].pos;
  var vel = particles[i].vel;
  let r = particles[i].radius;
  var moved = false;

  // PROTOTYPE (interactions): paddle mode makes the pointer a solid disc that
  // pushes particles out and carries them at its own velocity.
  if (params.toolMode == 6u && params.tool.w != 0.0 && r > 0.0) {
    let fromTool = pos - params.tool.xy;
    let dist = length(fromTool);
    let surface = params.tool.z + r;
    if (dist < surface) {
      let normal = select(vec2<f32>(1.0, 0.0), fromTool / max(dist, 1e-6), dist > 1e-6);
      pos = params.tool.xy + normal * surface;
      let rel = vel - params.toolVel.xy;
      let inward = dot(rel, normal);
      if (inward < 0.0) {
        vel -= 1.3 * inward * normal;
      }
      moved = true;
    }
  }

  let c = constrainToBoundary(pos, vel, r);
  if (!c.moved && !moved) {
    return;
  }
  particles[i].pos = c.pos;
  particles[i].vel = c.velocity;
}
