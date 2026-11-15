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
  var radius = verletObjects[voIndex].colorAndRadius.w;

  if (params.clickPoint.z != 0) {
    var posDiff = params.clickPoint.xy - pos;
    var mag = length(posDiff);
    // A particle exactly at the click point has no direction to it, so it
    // receives no click force.
    accel = vec2<f32>(0.0, 0.0);
    if (mag > 0) {
      accel = (posDiff / mag) * params.clickPoint.z * radius;
    }
  } else {
    accel += vec2<f32>(0.0, 2000.0 * radius);
  }
  
  verletObjects[voIndex].accel = vec4<f32>(accel.xy, 0.0, 0.0);
}