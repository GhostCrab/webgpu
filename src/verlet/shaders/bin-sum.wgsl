@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;
@group(2) @binding(1) var<storage, read_write> binInfo: BinSumInfo;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = u32(GlobalInvocationID.x);

  if (index >= binParams.count) {
    return;
  }

  binInfo.binSum[index] = 0u;

  for (var voIndex = 0u; voIndex < arrayLength(&verletObjects); voIndex++) {
    if (binInfo.bin[voIndex] == i32(index)) {
      binInfo.binSum[index]++;
    }
  }
}