// One level of a blocked exclusive prefix sum. Each workgroup scans one block
// of SCAN_BLOCK values in place and writes the block's total to blockSums.
// bin-grid.ts scans the block totals the same way, level by level, until one
// block holds them all, then adds each level's scanned totals back into the
// level below. Work is linear in the number of values, so it scales to
// millions of bins.

@group(0) @binding(2) var<storage, read_write> scanData: array<u32>;
@group(0) @binding(3) var<storage, read_write> blockSums: array<u32>;

const SCAN_BLOCK = 256u;

var<workgroup> block: array<u32, SCAN_BLOCK>;

@compute @workgroup_size(SCAN_BLOCK)
fn scanBlocks(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(local_invocation_index) local: u32,
  @builtin(workgroup_id) group: vec3<u32>
) {
  let i = id.x;
  let inRange = i < arrayLength(&scanData);
  var value = 0u;
  if (inRange) {
    value = scanData[i];
  }

  // An inclusive scan of the block in workgroup memory.
  block[local] = value;
  workgroupBarrier();
  for (var offset = 1u; offset < SCAN_BLOCK; offset *= 2u) {
    var add = 0u;
    if (local >= offset) {
      add = block[local - offset];
    }
    workgroupBarrier();
    block[local] += add;
    workgroupBarrier();
  }

  if (inRange) {
    scanData[i] = block[local] - value;
  }
  if (local == SCAN_BLOCK - 1u) {
    blockSums[group.x] = block[local];
  }
}

@compute @workgroup_size(SCAN_BLOCK)
fn addBlockSums(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>
) {
  if (id.x < arrayLength(&scanData)) {
    scanData[id.x] += blockSums[group.x];
  }
}
