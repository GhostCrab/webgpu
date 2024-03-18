@group(2) @binding(1) var<storage, read_write> binInfo: BinInfo;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var binIndex = u32(GlobalInvocationID.x);

  if (binIndex >= binParams.count) {
    return;
  }

  binInfo.binIndexTracker[binIndex] = 0;

  if (binIndex > 0) {
    binInfo.binIndexTracker[binIndex] = binInfo.binPrefixSum[binIndex - 1];
  }
}