// Definitions shared by every compute shader. This file is prepended to each
// one (see shader-source.ts), and it is the single description of these
// layouts: particle-layout.ts reads the struct definitions from here.

struct Params {
  totalTime: f32,
  deltaTime: f32,
  constrainRadius: f32,
  boxDim: f32,
  constrainType: u32,
  unused1: u32,
  unused2: u32,
  // The furthest a particle may move in one substep: the smallest radius.
  speedLimit: f32,
  constrainCenter: vec4<f32>,
  // xy: the point, z: the force (positive attracts, negative repels, 0 is off)
  clickPoint: vec4<f32>,
};

// A particle of the new pipeline (spec #9). Its colour is not here: it lives in
// a buffer of its own, indexed by id, that only drawing reads.
struct Particle {
  pos: vec2<f32>,
  // In simulation units per second.
  vel: vec2<f32>,
  // 0 disables the particle: it does not draw.
  radius: f32,
  // Identifies the particle for its whole life, wherever it sits in memory.
  id: u32,
}

// A particle of the current pipeline.
struct VerletObject {
  pos: vec4<f32>,
  prevPos: vec4<f32>,
  accel: vec4<f32>,
  colorAndRadius: vec4<f32>,
  binLink: i32,
  unused1: f32,
  unused2: f32,
  unused3: f32,
}

// The same memory as VerletObject, viewed with an atomic binLink so bin-set
// can build the bin lists without locks. The two must stay field-for-field
// identical; particle-layout.test.ts checks that they do.
struct VerletObjectAtomicBin {
  pos: vec4<f32>,
  prevPos: vec4<f32>,
  accel: vec4<f32>,
  colorAndRadius: vec4<f32>,
  binLink: atomic<i32>,
  unused1: f32,
  unused2: f32,
  unused3: f32,
}

struct BinParams {
  size: i32,
  x: i32,
  y: i32,
  count: u32,
}

struct CollisionStepOffset {
  xOffset: i32,
  yOffset: i32,
}

@group(0) @binding(1) var<uniform> params: Params;
@group(1) @binding(0) var<uniform> binParams: BinParams;

// Fraction of the normal speed a particle keeps when it bounces off the
// boundary circle under the reflective constrain.
const BOUNDARY_RESTITUTION = 0.8;
// Fraction of the speed along the boundary a particle keeps each substep it
// spends past the boundary circle under the classic constrain.
const CLASSIC_DAMPING = 0.95;

struct Constrained {
  pos: vec2<f32>,
  velocity: vec2<f32>,
  // False when the particle was inside the boundary circle and is unchanged.
  moved: bool,
}

// The selected constrain, shared by both pipelines' constrain shaders. A
// particle past the boundary circle is placed back on it. Its velocity is its
// own, never the distance it is moved back, so a particle far outside the
// circle returns to it without being flung across. The result is linear in
// velocity, so it holds whatever units velocity is measured in.
fn constrainToBoundary(pos: vec2<f32>, velocity: vec2<f32>, radius: f32) -> Constrained {
  let center = params.constrainCenter.xy;
  let edge = params.constrainRadius - radius;
  let fromCenter = pos - center;
  let dist = length(fromCenter);

  if (dist <= edge) {
    return Constrained(pos, velocity, false);
  }

  let outward = fromCenter / dist;
  var v = velocity;
  let outwardSpeed = dot(v, outward);

  if (params.constrainType == 0) {
    // Classic: the particle stops at the edge.
    if (outwardSpeed > 0.0) {
      v -= outwardSpeed * outward;
    }
    v *= CLASSIC_DAMPING;
  } else if (outwardSpeed > 0.0) {
    // Reflective: only a particle moving outward bounces, and it loses normal
    // speed only. One that is already moving inward keeps its velocity.
    v -= (1.0 + BOUNDARY_RESTITUTION) * outwardSpeed * outward;
  }

  return Constrained(center + outward * edge, v, true);
}

// Shortens v to at most `limit`, keeping its direction. The speed limit uses
// it so that no particle moves further than the smallest radius in a substep.
fn limitLength(v: vec2<f32>, limit: f32) -> vec2<f32> {
  let len = length(v);
  if (len > limit) {
    return v * (limit / len);
  }
  return v;
}
