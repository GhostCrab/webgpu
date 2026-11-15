@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }

  var pos = verletObjects[voIndex].pos.xy;
  var prevPos = verletObjects[voIndex].prevPos.xy;
  var accel = verletObjects[voIndex].accel.xy;

  // The speed limit: no particle moves further than the smallest radius in one
  // substep, so none can pass through another.
  let displacement = limitLength(
    (pos - prevPos) + (accel * (params.deltaTime * params.deltaTime)),
    params.speedLimit
  );
  prevPos = pos;
  pos = pos + displacement;

  verletObjects[voIndex].accel = vec4<f32>(0.0);
  verletObjects[voIndex].pos = vec4<f32>(pos.xy, 0.0, 0.0);
  verletObjects[voIndex].prevPos = vec4<f32>(prevPos.xy, 0.0, 0.0);

  verletObjects[voIndex].binLink = -1;
}