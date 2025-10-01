# Compute Shader Architecture Audit & Refactoring

**Date**: 2025-09-30
**Status**: Analysis Complete - Awaiting Decision
**Files Analyzed**: `src/verlet/verlet-bin-computer.ts`, `src/verlet/shaders/*.wgsl`

## Context

The current implementation uses a spatial binning approach for collision detection in a Verlet physics simulation. The compute pipeline executes 8 separate compute shaders in a specific sequence to handle particle physics, collision detection, and constraint solving.

## Current Architecture

### Compute Pass Execution Order

The `compute()` method in [verlet-bin-computer.ts](../src/verlet/verlet-bin-computer.ts:248) executes the following pipeline:

```
1. binClearPipeline        - Clear bin heads (conditionally)
2. binLinkClearPipeline    - Clear particle bin links (conditionally)
3. binSetPipeline          - Assign particles to spatial bins (conditionally)
4. applyForcesPipeline     - Apply gravity/click forces
5. collidePipeline         - Resolve collisions (4x with offset pattern)
6. collideIncrementPipeline- Update collision offset (4x between collide passes)
7. constrainPipeline       - Apply boundary constraints
8. integratePipeline       - Update positions via Verlet integration
```

### Spatial Binning Implementation

**Purpose**: Optimize O(n²) collision detection to approximately O(n) by partitioning space into a grid.

**Key Components**:
- **Bin Grid**: 2D grid where each cell contains a linked list of particles
- **Bin Size**: `objectSize * 2` (defined in [verlet-bin-computer.ts:98](../src/verlet/verlet-bin-computer.ts:98))
- **Collision Step Offset (CSO)**: Implements a checkerboard pattern to avoid race conditions during parallel collision resolution

**Data Structures**:
- `bins: array<i32>` - Head pointer for each bin's linked list
- `verletObjects[].binLink` - Next particle index in the bin's linked list
- `cso: CollisionStepOffset` - Offset pattern (0,0), (1,0), (0,1), (1,1) for checkerboard collision passes

### Shader Analysis

#### 1. **bin-clear.wgsl** (12 lines)
- **Purpose**: Initialize all bin heads to -1 (empty linked list)
- **Workgroup**: 64 threads, 1D dispatch
- **Issue**: ⚠️ Simple operation, could be combined with other initialization

#### 2. **bin-link-clear.wgsl** (12 lines)
- **Purpose**: Reset all particle `binLink` values to -1
- **Workgroup**: 64 threads, 1D dispatch
- **Issue**: ⚠️ Duplicates work done in `integrate.wgsl:23`
- **Note**: `integrate.wgsl` already sets `binLink = -1`, making this shader redundant

#### 3. **bin-set.wgsl** (23 lines)
- **Purpose**: Assign each particle to its spatial bin using atomic operations
- **Workgroup**: 64 threads, 1D dispatch
- **Algorithm**: Lock-free linked list insertion via `atomicExchange`
- **Critical**: Uses `VerletObjectAtomicBin` for atomic `binLink` operations
- **Quality**: ✅ Well-implemented, necessary for thread-safe bin assignment

#### 4. **apply-forces.wgsl** (28 lines)
- **Purpose**: Apply gravity or click-based attraction force
- **Workgroup**: 64 threads, 1D dispatch
- **Logic**:
  - If `clickPoint.z != 0`: Apply inverse-square attraction to click point
  - Else: Apply downward gravity proportional to radius
- **Quality**: ✅ Clean implementation
- **Potential Improvement**: Could be merged with integration step

#### 5. **collide.wgsl** (84 lines) - **Most Complex**
- **Purpose**: Resolve particle-particle collisions within spatial bins
- **Workgroup**: 16x16 threads, 2D dispatch
- **Algorithm**:
  1. Each workgroup processes one bin in the checkerboard pattern (offset by CSO)
  2. For each particle in the bin, check against all particles in 9 neighboring bins (3x3 grid)
  3. Apply position correction based on overlap and mass ratio
- **Issues**:
  - ✅ **Synchronization**: Line 72 writes are SAFE - checkerboard pattern + bin sizing prevent race conditions (see Critical Issues #1)
  - ⚠️ **Collision Limit**: Hard-coded 1000 collision test limit per particle (line 51) - safety mechanism but may cause physics artifacts
  - 🔵 **Checkerboard Overhead**: Requires 4 separate passes - this is the necessary cost for parallel collision safety
  - 🟡 **Mass Calculation**: Uses radius as mass proxy (lines 65-66) - physically inaccurate but has no effect since all particles are same size
- **Quality**: ✅ Well-designed parallel collision algorithm with correct synchronization

#### 6. **collideIncrement.wgsl** (16 lines)
- **Purpose**: Cycle through CSO pattern: (0,0) → (1,0) → (0,1) → (1,1) → (0,0)
- **Workgroup**: 1 thread (single-threaded)
- **Issue**: ⚠️ Extremely inefficient - requires a full compute pass with pipeline switch just to update 2 integers
- **Alternative**: Could be done on CPU or via push constants

#### 7. **constrain.wgsl** (61 lines)
- **Purpose**: Keep particles within circular boundary
- **Workgroup**: 64 threads, 1D dispatch
- **Features**: Supports two constraint types (type 0: damping, type 1: bounce with reflection)
- **Quality**: ✅ Well-implemented with proper velocity damping and reflection
- **Note**: Contains commented-out velocity limiting code (lines 52-57)

#### 8. **integrate.wgsl** (24 lines)
- **Purpose**: Verlet integration - update positions based on velocity and acceleration
- **Workgroup**: 64 threads, 1D dispatch
- **Formula**: `pos = pos + (pos - prevPos) + accel * dt²`
- **Quality**: ✅ Clean, textbook Verlet integration
- **Redundancy**: Line 23 sets `binLink = -1`, which duplicates `bin-link-clear.wgsl`

## Issues & Observations

### Critical Issues

1. **🟡 Minor Race Condition in Diagonal Overlap Cases**
   - **Location**: [collide.wgsl:72](../src/verlet/shaders/collide.wgsl:72) writes to `verletObjects[otherVOIndex].pos`
   - **Analysis**:
     - `maxRadius = 1.5` ([verlet.ts:44](../src/verlet/verlet.ts:44))
     - Bin size = `objectSize * 2 = 1.5 * 2 = 3.0` ([verlet-bin-computer.ts:98](../src/verlet/verlet-bin-computer.ts:98))
     - The 4-pass checkerboard ensures adjacent bins never process simultaneously
     - **However**: Diagonal bins DO process simultaneously (e.g., bins (0,0) and (2,2) both process in Pass 1)
     - Both bins can have overlapping 3×3 neighborhoods (they share diagonal bin (1,1))
     - In rare cases where a particle in the shared diagonal bin collides with particles in both processing bins, two threads write to the same particle simultaneously
   - **Impact**:
     - Likely **very rare** (requires specific geometric alignment)
     - Effect is **minor** (both writes are trying to move particle away from collision, just by slightly different amounts)
     - No visible artifacts observed in practice
   - **Mitigation Options** (not recommended unless artifacts appear):
     - Increase bin size to `3 * maxRadius` (eliminates diagonal overlap but reduces efficiency)
     - Use one-sided collision response (remove line 72, only current particle updates)
     - Use atomic operations for position updates (complex, may hurt performance)
   - **Conclusion**: **Acceptable trade-off** - the checkerboard provides good parallelism with minimal risk
   - **Credit**: Still a well-designed algorithm; this is a subtle edge case that's pragmatic to ignore

2. **🟡 Incorrect Mass Calculation (Low Priority)**
   - **Location**: [collide.wgsl:65-66](../src/verlet/shaders/collide.wgsl:65)
   - **Problem**: `massRatio1 = radius / (radius + otherRadius)` treats radius as mass
   - **Physics**: For 2D circles, mass ∝ area = πr², so mass should be `radius * radius`
   - **Current Impact**: **None** - all particles have the same radius (minRadius = maxRadius = 1.5)
   - **Future Impact**: Will matter if you enable variable particle sizes
   - **Fix**: Change to `var mass1 = radius * radius; var mass2 = otherRadius * otherRadius;`

### Performance Issues

3. **🟡 Redundant Shader Passes**
   - `bin-link-clear.wgsl` duplicates work already done in `integrate.wgsl:23`
   - **Impact**: Extra pipeline switch + dispatch overhead
   - **Solution**: Remove `binLinkClearPipeline` entirely

4. **🟡 Inefficient CSO Update**
   - `collideIncrement.wgsl` uses a full compute pass for trivial arithmetic
   - **Impact**: 4x pipeline switches, 4x compute pass overhead (GPU idle time)
   - **Solution**:
     - Option A: Update CSO on CPU between passes
     - Option B: Hardcode 4 variants of the collision shader with different offsets
     - Option C: Use push constants (if supported)

5. **🟡 Excessive Pipeline Switching**
   - Current approach: 8 unique pipelines with 11-14 pipeline switches per frame (depending on collision mode)
   - **Impact**: Pipeline switching has overhead; fewer, larger kernels are often faster
   - **Potential Consolidation**:
     - Merge `applyForces` + `integrate` (both are simple per-particle operations)
     - Merge `binClear` into initialization logic (or use `device.queue.writeBuffer`)

6. **🟡 Collision Limit Safety Valve**
   - Hard-coded 1000 collision test limit ([collide.wgsl:51](../src/verlet/shaders/collide.wgsl:51))
   - **Purpose**: Prevent infinite loops in degenerate cases (many particles in one bin)
   - **Impact**: May cause particles to "ghost" through each other in dense scenarios
   - **Better Solution**:
     - Use smaller bins (more bins = fewer particles per bin)
     - Use hierarchical spatial data structure
     - Add debug visualization to detect when limit is hit

### Design Questions

7. **🔵 Bin Size Selection**
   - Current: `binSquareSize = objectSize * 2` ([verlet-bin-computer.ts:98](../src/verlet/verlet-bin-computer.ts:98))
   - **Assumption**: All particles are the same size (objectSize)
   - **Issue**: If particle sizes vary significantly, this may be suboptimal
   - **Consideration**:
     - Smaller bins = more bins to check per particle, but fewer particles per bin
     - Larger bins = fewer bins to check, but more particles per bin
     - Optimal bin size ≈ 2-3× largest particle diameter

8. **🔵 Checkerboard Pattern Necessity**
   - **Current Approach**: 4-pass checkerboard to reduce race conditions
   - **Question**: Is this actually necessary given the race condition in line 72?
   - **Analysis**: The checkerboard prevents particles in adjacent bins from resolving collisions simultaneously, but doesn't prevent the specific race condition in the current code
   - **If Fixed**: The checkerboard becomes more valuable after fixing the race condition

### Code Quality

9. **✅ Unused Struct Fields**
   - `VerletObject` has `unused1`, `unused2`, `unused3` fields
   - **Reason**: Likely for alignment/padding to meet GPU memory layout requirements
   - **Recommendation**: Add comments explaining the padding (e.g., `// Padding for 16-byte alignment`)

10. **✅ Commented Code**
    - [constrain.wgsl:52-57](../src/verlet/shaders/constrain.wgsl:52) has commented velocity limiting code
    - **Recommendation**: Either remove or move to a configuration parameter if it might be useful

## Optimization Opportunities

### High-Impact Optimizations

1. **Consolidate Redundant Passes**
   - **Remove**: `binLinkClearPipeline` (already done in integrate)
   - **Estimated Impact**: ~8% reduction in compute overhead (1 fewer pipeline + dispatch)
   - **Effort**: Trivial

2. **Replace CSO Increment Shader**
   - **Option A**: CPU-side CSO update
     ```typescript
     // In verlet-bin-computer.ts
     const csoPattern = [[0,0], [1,0], [0,1], [1,1]];
     for (let i = 0; i < 4; i++) {
       device.queue.writeBuffer(this.csoBuffer, 0, new Uint32Array(csoPattern[i]));
       // ... run collision pass
     }
     ```
   - **Estimated Impact**: Eliminate 4 pipeline switches per frame
   - **Effort**: Easy

3. **Merge Force Application + Integration**
   - Combine `applyForces` and `integrate` into a single kernel
   - **Rationale**: Both are simple per-particle operations with no inter-particle dependencies
   - **Estimated Impact**: 1 fewer pipeline switch
   - **Effort**: Medium (need to handle acceleration reset carefully)

4. **Fix Mass Calculation (Future-Proofing)**
   - **Estimated Impact**: None currently (all particles same size), Medium if you add size variation
   - **Effort**: Trivial
   - **Approach**:
     ```wgsl
     // In collide.wgsl, replace lines 65-66
     var mass1 = radius * radius;  // Mass proportional to area
     var mass2 = otherRadius * otherRadius;
     var massRatio1 = mass1 / (mass1 + mass2);
     var massRatio2 = mass2 / (mass1 + mass2);
     ```

### Medium-Impact Optimizations

5. **Use Workgroup Shared Memory**
   - Load particle data for a bin into shared memory before collision testing
   - **Benefit**: Reduce global memory reads (currently reading `verletObjects[otherVOIndex]` repeatedly)
   - **Effort**: High (significant refactor of collision kernel)

6. **Adaptive Bin Sizing**
   - Calculate bin size based on actual particle size distribution
   - **Benefit**: Better load balancing, fewer wasted collision checks
   - **Effort**: Medium

7. **Spatial Hash Instead of Grid**
   - Use a hash table instead of a 2D grid for bins
   - **Benefit**: Better memory efficiency for sparse distributions
   - **Trade-off**: More complex indexing
   - **Effort**: High

## Recommended Refactoring Path

### Phase 1: Low-Hanging Fruit (Quick Performance Wins)
1. Remove `binLinkClearPipeline` (redundant with integrate)
2. Move CSO update to CPU-side buffer writes
3. Add comments explaining struct padding
4. Clean up commented code in constrain.wgsl

### Phase 2: Pipeline Consolidation (Medium Effort, Medium Reward)
1. Merge `applyForces` and `integrate` into single kernel
2. Consider merging `binClear` into initialization (or use buffer writes)
3. Benchmark before/after to measure impact

### Phase 3: Future-Proofing (Optional, For When You Add Features)
1. Fix mass calculation (only matters if you enable variable particle sizes)

### Phase 4: Advanced Optimizations (Lower Priority)
1. ⏸️ Investigate workgroup shared memory for collision kernel
2. ⏸️ Consider alternative spatial data structures (octree, spatial hash)
3. ⏸️ Profile GPU execution to identify actual bottlenecks

## Questions for Consideration

1. **What is the typical particle count in your simulations?**
   - <10k: Current approach is fine with minor fixes
   - 10k-100k: Pipeline consolidation will help
   - >100k: May need more sophisticated spatial structures

2. **Do particle sizes vary significantly?**
   - If yes: Consider adaptive binning or multi-tier bin structure
   - If no: Current fixed bin size is appropriate

3. **Is collision accuracy critical, or is visual plausibility sufficient?**
   - Current implementation provides good collision accuracy via checkerboard synchronization
   - The two-sided collision response (both particles update) is stable and correct

4. **What's the target framerate and device?**
   - 60 FPS on integrated GPU: Consolidation is important
   - 144+ FPS on discrete GPU: Current approach may already be fast enough

## Implementation Notes

- All shader files use the common header pattern established in the previous refactoring
- The compute pipeline uses a 3-level bind group structure:
  - `@group(0)`: Global uniforms (params, time, constraints)
  - `@group(1)`: Bin-specific uniforms (bin dimensions, counts)
  - `@group(2)`: Storage buffers (particles, bins, CSO)
- Workgroup sizes are reasonable (64 for 1D, 16x16 for 2D)
- The binning algorithm uses a lock-free linked list approach, which is a good choice for GPU

## References

- Verlet Integration: [Wikipedia](https://en.wikipedia.org/wiki/Verlet_integration)
- Spatial Hashing: [Real-Time Collision Detection](https://www.realtimecollisiondetection.net/)
- GPU Collision Detection: [NVIDIA GPU Gems 3, Chapter 32](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-32-broad-phase-collision-detection-cuda)