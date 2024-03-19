@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObjectCollide>;
@group(2) @binding(1) var<storage, read_write> binInfo: BinInfo;

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

  var startIndex = 0;
  if (binIndex > 0) {
    startIndex = binInfo.binPrefixSum[binIndex - 1];
  }

  // iterate over all objects in the current bin
  for (var i = startIndex; i < binInfo.binPrefixSum[binIndex]; i++) {
    var voIndex = binInfo.binReindex[i];
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

      var startOtherIndex = 0;
      if (neighborIndex == 4) {
        startOtherIndex = i + 1;
      } else if (neighborIndex > 0) {
        startOtherIndex = binInfo.binPrefixSum[neighborIndex - 1];
      }

      for (var j = startOtherIndex; j < binInfo.binPrefixSum[neighborIndex]; j++) {
        var otherVOIndex = binInfo.binReindex[j];
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