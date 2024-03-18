@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;
@group(2) @binding(1) var<storage, read_write> binInfo: BinSumInfo;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }

  var binIndex = binInfo.bin[voIndex];

  atomicAdd(&binInfo.binSum[binIndex], 1);

  return;
}