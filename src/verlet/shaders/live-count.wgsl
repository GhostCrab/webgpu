// Keeps the live count on the GPU, with the indirect dispatch and draw sized
// from it, so the CPU never waits to learn it. Each entry point is one
// single-invocation dispatch:
//
//   countPlaced  after a bin grid build: the particles it placed are the live
//                ones
//   grow         after spawned particles are appended: they are live too, up
//                to the capacity

// The bin starts after the scan; the last entry is the number of particles
// the build placed.
@group(0) @binding(2) var<storage, read> binTotals: array<u32>;
@group(0) @binding(4) var<storage, read_write> liveOut: LiveParticles;
@group(0) @binding(5) var<uniform> edit: Edit;

fn setLiveCount(count: u32) {
  liveOut.count = count;
  liveOut.workgroupsX = (count + PARTICLE_WORKGROUP_SIZE - 1u) / PARTICLE_WORKGROUP_SIZE;
  liveOut.instanceCount = count;
}

@compute @workgroup_size(1)
fn countPlaced() {
  setLiveCount(binTotals[arrayLength(&binTotals) - 1u]);
}

@compute @workgroup_size(1)
fn grow() {
  setLiveCount(min(liveOut.count + edit.added, edit.capacity));
}
