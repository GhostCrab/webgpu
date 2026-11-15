@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;

// Runs after the integrate, so a particle that crossed the boundary circle in
// this substep is back on it before the substep ends. Velocity is the
// particle's own move over the substep (pos - prevPos).
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }

  let pos = verletObjects[voIndex].pos.xy;
  let radius = verletObjects[voIndex].colorAndRadius.w;
  let c = constrainToBoundary(pos, pos - verletObjects[voIndex].prevPos.xy, radius);
  if (!c.moved) {
    return;
  }

  verletObjects[voIndex].pos = vec4<f32>(c.pos, 0.0, 0.0);
  verletObjects[voIndex].prevPos = vec4<f32>(c.pos - c.velocity, 0.0, 0.0);
}
