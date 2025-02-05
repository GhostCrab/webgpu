@group(2) @binding(2) var<storage, read_write> cso: CollisionStepOffset;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  if (cso.xOffset == 0 && cso.yOffset == 0) {
    cso.xOffset = 1;
  } else if (cso.xOffset == 1 && cso.yOffset == 0) {
    cso.xOffset = 0;
    cso.yOffset = 1;
  } else if (cso.xOffset == 0 && cso.yOffset == 1) {
    cso.xOffset = 1;
  } else { //if (cso.xOffset == 1 && cso.yOffset == 1) {
    cso.xOffset = 0;
    cso.yOffset = 0;
  }
}