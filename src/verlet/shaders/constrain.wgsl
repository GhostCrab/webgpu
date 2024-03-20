@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }

  var constrainCenter = params.constrainCenter.xy;
  var constrainRadius = params.constrainRadius;

  var pos = verletObjects[voIndex].pos.xy;
  var prevPos = verletObjects[voIndex].prevPos.xy;
  var radius = verletObjects[voIndex].colorAndRadius.w;

  var v = constrainCenter - pos;
  var dist = length(v);

  if (dist > constrainRadius - radius) {
    if (params.constrainType == 0) {
      var n = v / dist;
      pos = constrainCenter - (n * (constrainRadius - radius));

      var prevVec = prevPos - pos;
      prevVec *= 0.95;
      prevPos = pos + prevVec;
    } else {
      var n = v / dist;
      var constrainPos = constrainCenter - (n * (constrainRadius - radius));

      var prevVec = prevPos - pos;
      var prevVecLen = length(prevVec);

      var constrainVec = prevPos - constrainPos;
      var constrainVecLen = length(constrainVec);

      // this is how far past constrainPos the vector between fakePrevPos and bouncedPos needs to be
      var bounceVecLen = constrainVecLen - prevVecLen;

      var reflectNormal = normalize(vec2f(-pos.xy));
      var oldVelo = pos - prevPos;

      // calculate the reflect vector
      var newVelo = reflect(oldVelo, reflectNormal);
      pos = constrainPos + (newVelo * bounceVecLen);
      prevPos = pos - (newVelo * .8);
    }
  }

  verletObjects[voIndex].pos = vec4<f32>(pos.xy, 0, 0);
  verletObjects[voIndex].prevPos = vec4<f32>(prevPos.xy, 0, 0);
}