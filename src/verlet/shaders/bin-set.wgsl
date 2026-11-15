@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObjectAtomicBin>;
@group(2) @binding(1) var<storage, read_write> bins: array<atomic<i32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var voIndex = u32(GlobalInvocationID.x);

  if (voIndex >= arrayLength(&verletObjects)) {
    return;
  }
  
  var pos = verletObjects[voIndex].pos.xy;

  // A particle outside the bin grid goes in the nearest edge bin, so it cannot
  // wrap into another row or index outside the bin buffer. Clamping before the
  // conversion to i32 keeps a particle very far out from overflowing it.
  var binx = i32(clamp(floor((pos.x + (f32(params.boxDim) / 2.0)) / f32(binParams.size)), 0.0, f32(binParams.x - 1)));
  var biny = i32(clamp(floor((pos.y + (f32(params.boxDim) / 2.0)) / f32(binParams.size)), 0.0, f32(binParams.y - 1)));

  var binIndex = (biny * binParams.x) + binx;

  var exchangeIndex = atomicExchange(&bins[binIndex], i32(voIndex));
  while (exchangeIndex != -1) {
    exchangeIndex = atomicExchange(&verletObjects[voIndex].binLink, exchangeIndex);
  }
}