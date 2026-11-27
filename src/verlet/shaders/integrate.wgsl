@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;

// Acceleration per unit of click force.
const CLICK_ACCELERATION = 1.5;

// The first stage of a substep: gravity or the click force into velocity, the
// speed limit, then position.
@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= live.count) {
    return;
  }

  let pos = particles[i].pos;
  let dt = params.deltaTime;
  // PROTOTYPE (interactions): gravity comes from the CPU, so tilt can turn it.
  var accel = params.gravity.xy;
  var vel = particles[i].vel;
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

  // PROTOTYPE (interactions): the tool modes. tool.xy the pointer, tool.z
  // the radius, tool.w the strength (0 is off).
  let fromTool = pos - params.tool.xy;
  let toolDist = length(fromTool);
  let radius = params.tool.z;
  let strength = params.tool.w;
  if (strength != 0.0 && toolDist > 0.0) {
    let away = fromTool / toolDist;
    if (params.toolMode == 1u && toolDist < radius) {
      // Stir: particles near the pointer are dragged toward its velocity.
      let falloff = 1.0 - toolDist / radius;
      vel = mix(vel, params.toolVel.xy, clamp(falloff * falloff * strength * dt, 0.0, 1.0));
    } else if (params.toolMode == 2u && toolDist < radius) {
      // Vortex: a swirl around the pointer with a little pull inward. The
      // strength's sign picks the direction of spin.
      let falloff = 1.0 - toolDist / radius;
      let tangent = vec2<f32>(-away.y, away.x);
      accel += (tangent * strength - away * abs(strength) * 0.35) * falloff;
    } else if (params.toolMode == 3u) {
      // Shockwave: a ring expanding from the pointer kicks what it passes.
      let ring = params.toolVel.w;
      let band = abs(toolDist - ring);
      if (band < radius) {
        accel += away * strength * (1.0 - band / radius);
      }
    }
  }

  // The speed limit: no particle moves further than the smallest radius in one
  // substep, so none can pass through another.
  vel = limitLength(vel + accel * dt, params.speedLimit / dt);
  particles[i].vel = vel;
  particles[i].pos = pos + vel * dt;
}
