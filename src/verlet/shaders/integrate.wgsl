@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;

// Gravity, in simulation units per second squared: the same for every
// particle, whatever its radius.
const GRAVITY = vec2<f32>(0.0, 3000.0);
// Acceleration per unit of click force.
const CLICK_ACCELERATION = 1.5;

// The first stage of a substep: gravity or the click force into velocity, the
// speed limit, then position.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= binGrid.particleCount) {
    return;
  }

  let pos = particles[i].pos;
  var accel = GRAVITY;
  if (params.clickPoint.z != 0.0) {
    // A particle exactly at the click point has no direction to it, so it
    // receives no click force.
    accel = vec2<f32>(0.0, 0.0);
    let toClick = params.clickPoint.xy - pos;
    let dist = length(toClick);
    if (dist > 0.0) {
      accel = (toClick / dist) * params.clickPoint.z * CLICK_ACCELERATION;
    }
  }

  let dt = params.deltaTime;
  // The speed limit: no particle moves further than the smallest radius in one
  // substep, so none can pass through another.
  let vel = limitLength(particles[i].vel + accel * dt, params.speedLimit / dt);
  particles[i].vel = vel;
  particles[i].pos = pos + vel * dt;
}
