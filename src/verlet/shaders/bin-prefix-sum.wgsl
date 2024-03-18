@group(2) @binding(1) var<storage, read_write> binInfo: BinPrefixSumInfo;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var binIndex = u32(GlobalInvocationID.x);

  if (binIndex < binParams.count) {
    binInfo.binPrefixSum[binIndex] = 0;

    for (var i = 0u; i <= binIndex; i++) {
      binInfo.binPrefixSum[binIndex] += i32(binInfo.binSum[i]);
    }
  }

  storageBarrier();

  if (binIndex < binParams.count) {
    atomicStore(&binInfo.binIndexTracker[binIndex], 0);
    if (binIndex > 0) {
      atomicStore(&binInfo.binIndexTracker[binIndex], binInfo.binPrefixSum[binIndex - 1]);
    }
  }
}