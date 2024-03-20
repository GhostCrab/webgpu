@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;
@group(2) @binding(1) var<storage, read_write> bins: array<i32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var binIndex = i32(GlobalInvocationID.x);

  if (binIndex >= i32(binParams.count)) {
    return;
  }

  var neighborIndexes = array<i32, 9>(
    binIndex - binParams.x - 1, binIndex - binParams.x, binIndex - binParams.x + 1,
    binIndex               - 1, binIndex,               binIndex               + 1,
    binIndex + binParams.x - 1, binIndex + binParams.x, binIndex + binParams.x + 1
  );

  for (var voIndex = bins[binIndex]; voIndex != -1; voIndex = verletObjects[voIndex].binLink) {
    var pos = verletObjects[voIndex].pos.xy;
    var radius = verletObjects[voIndex].colorAndRadius.w;
    var offset = vec2<f32>(0.0, 0.0);

    if (radius == 0) {
      continue;
    }

    for (var neighborIndexIndex = 0; neighborIndexIndex < 9; neighborIndexIndex++) {
      var neighborIndex = neighborIndexes[neighborIndexIndex];
      if (neighborIndex < 0 || neighborIndex >= i32(binParams.count)) {
        continue;
      }

      var startOtherIndex = bins[neighborIndex];
      if (neighborIndex == 4) {
        startOtherIndex = verletObjects[voIndex].binLink;
      }

      for (var otherVOIndex = startOtherIndex; otherVOIndex != -1; otherVOIndex = verletObjects[otherVOIndex].binLink) {
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
            offset -= n * (massRatio * delta);

            // move other object
            verletObjects[otherVOIndex].pos = vec4<f32>(verletObjects[otherVOIndex].pos.xy + (n * (massRatio * delta)), 0.0, 0.0);
          }
        }
      }
    }

    verletObjects[voIndex].pos = vec4<f32>(verletObjects[voIndex].pos.xy + offset, 0.0, 0.0);
  }
}