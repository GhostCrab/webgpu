@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;

// Fraction of the normal speed a particle keeps when it bounces off the
// boundary circle under the reflective constrain.
const BOUNDARY_RESTITUTION = 0.8;
// Fraction of the speed along the boundary a particle keeps each substep it
// spends past the boundary circle under the classic constrain.
const CLASSIC_DAMPING = 0.95;

// Runs after the integrate, so a particle that crossed the boundary circle in
// this substep is back on it before the substep ends. Velocity is the
// particle's own (pos - prevPos), never the distance it is moved back, so a
// particle far outside the circle returns to it without being flung across.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }

  let center = params.constrainCenter.xy;
  let radius = verletObjects[voIndex].colorAndRadius.w;
  let edge = params.constrainRadius - radius;

  var pos = verletObjects[voIndex].pos.xy;
  let fromCenter = pos - center;
  let dist = length(fromCenter);

  if (dist <= edge) {
    return;
  }

  let outward = fromCenter / dist;
  var velocity = pos - verletObjects[voIndex].prevPos.xy;
  let outwardSpeed = dot(velocity, outward);

  if (params.constrainType == 0) {
    // Classic: the particle stops at the edge.
    if (outwardSpeed > 0.0) {
      velocity -= outwardSpeed * outward;
    }
    velocity *= CLASSIC_DAMPING;
  } else if (outwardSpeed > 0.0) {
    // Reflective: only a particle moving outward bounces, and it loses normal
    // speed only. One that is already moving inward keeps its velocity.
    velocity -= (1.0 + BOUNDARY_RESTITUTION) * outwardSpeed * outward;
  }

  pos = center + outward * edge;
  verletObjects[voIndex].pos = vec4<f32>(pos, 0.0, 0.0);
  verletObjects[voIndex].prevPos = vec4<f32>(pos - velocity, 0.0, 0.0);
}
