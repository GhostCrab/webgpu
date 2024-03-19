@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;

fn hash11(p: f32) -> f32 {
  var next = fract(p * .1031);
  next *= next + 33.33;
  next *= next + next;
  return fract(next);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }

  var pos = verletObjects[voIndex].pos.xy;
  var prevPos = verletObjects[voIndex].prevPos.xy;
  var accel = verletObjects[voIndex].accel.xy;

  if (params.clickPoint.x != 0 && params.clickPoint.y != 0) {
    var _pos = params.clickPoint.xy;
    var posDiff = _pos - pos;
    var mag = length(posDiff);
    var invMag2 = 1 / (mag * mag);
    var posDiffNorm = posDiff / mag;
    accel = posDiffNorm * 4000;
  } else {
    accel += vec2<f32>(0.0, 0.0);
  }

  // sometimes accelerate a particle to add FUN
  // if (hash11((params.totalTime * f32(voIndex))) > 0.999) {
  //   var velocityDir = normalize(pos - prevPos);
  //   accel += velocityDir * 100000;
  // }

  // if (hash11((params.totalTime * f32(voIndex) * f32(voIndex))) > 0.99) {
  //   var velocityDir = normalize(prevPos - pos);
  //   accel += velocityDir * 100000;
  // }

  verletObjects[voIndex].accel = vec4<f32>(accel.xy, 0.0, 0.0);
}