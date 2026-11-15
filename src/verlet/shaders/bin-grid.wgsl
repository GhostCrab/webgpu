// The bin grid build, by counting sort (ADR-0003). Each entry point is one
// dispatch; in order:
//
//   clearBins       zero every bin's count
//   countBins       count the particles in each bin
//   (the blocked scan in bin-scan.wgsl turns the counts into bin starts)
//   writeKeys       list each bin's particle ids in its run of binKeys
//   placeParticles  copy each particle to its place in sortedParticles
//
// Afterwards each bin's particles are one contiguous run of sortedParticles,
// from binStarts[bin] up to binStarts[bin + 1], in particle id order. The
// order never depends on thread timing (ADR-0001): the atomic counts decide
// only where an id is listed in binKeys, and a particle's place is its rank
// by id among the ids listed for its bin.

// One count per bin, plus one more. After the scan, the start of each bin's
// run, and in the last entry the number of particles.
@group(1) @binding(2) var<storage, read_write> binStarts: array<atomic<u32>>;
// Per particle, in the order of `particles`: where countBins listed it
// within its bin. Depends on thread timing; used only to fill binKeys.
@group(1) @binding(3) var<storage, read_write> binSlots: array<u32>;
// The particle ids of each bin's run, in the order countBins listed them.
@group(1) @binding(4) var<storage, read_write> binKeys: array<u32>;

@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(2) @binding(1) var<storage, read_write> sortedParticles: array<Particle>;

@compute @workgroup_size(256)
fn clearBins(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x <= binGrid.binCount) {
    atomicStore(&binStarts[id.x], 0u);
  }
}

@compute @workgroup_size(64)
fn countBins(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= binGrid.particleCount) {
    return;
  }
  binSlots[i] = atomicAdd(&binStarts[binIndex(particles[i].pos)], 1u);
}

@compute @workgroup_size(64)
fn writeKeys(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= binGrid.particleCount) {
    return;
  }
  let start = atomicLoad(&binStarts[binIndex(particles[i].pos)]);
  binKeys[start + binSlots[i]] = particles[i].id;
}

@compute @workgroup_size(64)
fn placeParticles(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= binGrid.particleCount) {
    return;
  }
  let p = particles[i];
  let bin = binIndex(p.pos);
  let start = atomicLoad(&binStarts[bin]);
  let end = atomicLoad(&binStarts[bin + 1u]);
  var rank = 0u;
  for (var k = start; k < end; k++) {
    if (binKeys[k] < p.id) {
      rank++;
    }
  }
  sortedParticles[start + rank] = p;
}
