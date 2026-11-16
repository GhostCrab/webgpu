// Spawn and erase, each run on its own as it arrives, between substeps.
//
//   erase   marks the live particles whose centres are within edit.radius of
//           edit.center erased, and counts them; the next bin grid build
//           leaves them out
//   append  copies the staged particles, and their colours, after the live
//           ones; grow in live-count.wgsl then counts them live

// The particles, and their colours at the same places.
@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;
// Spawned particles waiting to be appended, from the start of the other
// particle buffer, which is free between substeps.
@group(2) @binding(1) var<storage, read_write> staged: array<Particle>;
@group(2) @binding(3) var<storage, read_write> colors: array<u32>;
@group(2) @binding(4) var<storage, read_write> stagedColors: array<u32>;

@group(3) @binding(0) var<uniform> edit: Edit;
// The number of particles this erase marked.
@group(3) @binding(1) var<storage, read_write> erased: atomic<u32>;

@compute @workgroup_size(64)
fn erase(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= live.count || isErased(particles[i])) {
    return;
  }
  if (distance(particles[i].pos, edit.center) < edit.radius) {
    particles[i].radius = -1.0;
    atomicAdd(&erased, 1u);
  }
}

@compute @workgroup_size(64)
fn append(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let to = live.count + i;
  if (i >= edit.added || to >= edit.capacity) {
    return;
  }
  particles[to] = staged[i];
  colors[to] = stagedColors[i];
}
