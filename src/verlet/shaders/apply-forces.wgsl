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

  // Apply click force (attraction/repulsion from mouse)
  if (params.clickPoint.z != 0) {
    var _pos = params.clickPoint.xy;
    var posDiff = _pos - pos;
    var mag = length(posDiff);
    var posDiffNorm = posDiff / mag;

    // Apply force based on gravity mode
    var clickAccel: f32;
    if (params.gravityMode == 0u) {
      // Mode 0: Constant - same acceleration for all particles
      clickAccel = params.clickPoint.z;
    } else if (params.gravityMode == 1u) {
      // Mode 1: Radius-scaled (original behavior)
      clickAccel = params.clickPoint.z * radius;
    } else {
      // Mode 2: Mass-based (force / mass)
      var mass = radius * radius;
      clickAccel = params.clickPoint.z / mass;
    }

    accel = posDiffNorm * clickAccel;
  } else {
    // Apply gravity based on gravity mode
    var gravityAccel: f32;
    if (params.gravityMode == 0u) {
      // Mode 0: Constant - physically correct (all objects fall at same rate)
      gravityAccel = params.gravityStrength;
    } else if (params.gravityMode == 1u) {
      // Mode 1: Radius-scaled - larger particles fall faster (original behavior)
      gravityAccel = params.gravityStrength * radius;
    } else {
      // Mode 2: Mass-based - same as constant for gravity (F=mg, a=F/m=g)
      // Included for completeness but behaves identically to mode 0
      gravityAccel = params.gravityStrength;
    }

    accel += vec2<f32>(0.0, gravityAccel);
  }
  
  verletObjects[voIndex].accel = vec4<f32>(accel.xy, 0.0, 0.0);
}