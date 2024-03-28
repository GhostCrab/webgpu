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
    var _pos = params.clickPoint.xy;
    var posDiff = _pos - pos;
    var mag = length(posDiff);
    var invMag2 = 1 / (mag * mag);
    var posDiffNorm = posDiff / mag;
    accel = posDiffNorm * params.clickPoint.z * radius;
  } else {
    accel += vec2<f32>(0.0, 200.0 * radius);
  }
  
  verletObjects[voIndex].accel = vec4<f32>(accel.xy, 0.0, 0.0);
}