@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;

// Fraction of the closing speed a particle keeps when it bounces off an
// obstacle.
const OBSTACLE_RESTITUTION = 0.3;

// The boundary stage of a substep: an obstacle tool effect pushes particles
// out of its disc, then the selected constrain, so that no substep ends with a
// particle outside the boundary circle.
@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= live.count) {
    return;
  }

  var pos = particles[i].pos;
  var vel = particles[i].vel;
  let radius = particles[i].radius;
  var moved = false;

  if (params.toolKind == 4u && radius > 0.0) {
    // A particle inside the obstacle is placed on its edge, and one closing on
    // it bounces as seen from the moving obstacle. One exactly at its centre
    // leaves along +x.
    let fromTool = pos - params.toolArea.xy;
    let dist = length(fromTool);
    let edge = params.toolArea.z + radius;
    if (dist < edge) {
      var normal = vec2<f32>(1.0, 0.0);
      if (dist > 0.0) {
        normal = fromTool / dist;
      }
      pos = params.toolArea.xy + normal * edge;
      let closing = dot(vel - params.toolMotion.xy, normal);
      if (closing < 0.0) {
        vel -= (1.0 + OBSTACLE_RESTITUTION) * closing * normal;
      }
      moved = true;
    }
  }

  let c = constrainToBoundary(pos, vel, radius);
  if (!c.moved && !moved) {
    return;
  }
  particles[i].pos = c.pos;
  particles[i].vel = c.velocity;
}
