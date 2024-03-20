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

  var velocity = pos - prevPos;
  prevPos = pos;
  pos = pos + velocity + (accel * (params.deltaTime * params.deltaTime));

  verletObjects[voIndex].accel = vec4<f32>(0.0);
  verletObjects[voIndex].pos = vec4<f32>(pos.xy, 0.0, 0.0);
  verletObjects[voIndex].prevPos = vec4<f32>(prevPos.xy, 0.0, 0.0);

  verletObjects[voIndex].binLink = -1;
}