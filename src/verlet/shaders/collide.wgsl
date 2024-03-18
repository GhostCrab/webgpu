@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }

  var pos = verletObjects[voIndex].pos.xy;
  var radius = verletObjects[voIndex].colorAndRadius.w;
  var offset = vec2<f32>(0.0, 0.0);

  if (radius == 0) {
    return;
  }

  for (var otherVOIndex = 0u; otherVOIndex < arrayLength(&verletObjects); otherVOIndex++) {
    var otherRadius = verletObjects[otherVOIndex].colorAndRadius.w;
    if (otherVOIndex != voIndex && otherRadius != 0) {
      var otherPos = verletObjects[otherVOIndex].pos.xy;

      var v = pos - otherPos;
      var dist2 = dot(v, v);
      var minDist = radius + otherRadius;
      if (dist2 < minDist * minDist) {
        var dist = sqrt(dist2);
        var n = v / dist;

        var massRatio = 0.5;
        var responseCoef = 0.65;
        var delta = 0.5 * responseCoef * (dist - minDist);
        offset += n * -(massRatio * delta);
      }
    }
  }

  verletObjects[voIndex].collisionOffset = vec4<f32>(offset.xy, 0.0, 0.0);
}