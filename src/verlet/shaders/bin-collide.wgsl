@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;
@group(2) @binding(1) var<storage, read_write> binInfo: BinSumInfo;

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

  var binIndex = binInfo.bin[voIndex];

  var neighborIndexes = array<i32, 9>(
    binIndex - binParams.x - 1, binIndex - binParams.x, binIndex - binParams.x + 1,
    binIndex               - 1, binIndex,               binIndex               + 1,
    binIndex + binParams.x - 1, binIndex + binParams.x, binIndex + binParams.x + 1
  );

  for (var neighborIndexIndex = 0; neighborIndexIndex < 9; neighborIndexIndex++) {
    var neighborIndex = neighborIndexes[neighborIndexIndex];
    if (neighborIndex < 0 || neighborIndex >= i32(binParams.count)) {
      continue;
    }

    var startOtherIndex = 0;
    if (neighborIndex > 0) {
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
          offset += n * -(massRatio * delta);
        }
      }
    }
  }

  verletObjects[voIndex].collisionOffset = vec4<f32>(offset.xy, 0.0, 0.0);
}