@group(2) @binding(1) var<storage, read_write> binInfo: BinPrefixSumInfo;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var binIndex = u32(GlobalInvocationID.x);
  var binSumIndex = u32(GlobalInvocationID.y);

  if (binIndex < binParams.count && binSumIndex < binParams.count) {
    if (binSumIndex <= binIndex) {
      atomicAdd(&binInfo.binPrefixSum[binIndex], i32(binInfo.binSum[binSumIndex]));
    }
  }
}