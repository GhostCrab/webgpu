@group(2) @binding(1) var<storage, read_write> bins: array<i32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var binIndex = u32(GlobalInvocationID.x);

  if (binIndex >= binParams.count) {
    return;
  }

  bins[binIndex] = -1;
}