@group(2) @binding(0) var<storage, read_write> particles: array<Particle>;

// Acceleration per unit of click force.
const CLICK_ACCELERATION = 1.5;
// Of a vortex's strength, the part that pulls toward its centre.
const VORTEX_PULL = 0.35;

// The first stage of a substep: gravity or the click force, and the tool
// effect, into velocity; the speed limit; then position.
@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= live.count) {
    return;
  }

  let pos = particles[i].pos;
  let dt = params.deltaTime;
  var vel = particles[i].vel;
  var accel = params.gravity.xy;
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

  // The tool effect, within its region. A particle exactly at its centre has
  // no direction from it and is left alone. The obstacle is the boundary
  // stage's.
  let fromTool = pos - params.toolArea.xy;
  let toolDist = length(fromTool);
  let toolRadius = params.toolArea.z;
  let strength = params.toolArea.w;
  if (toolDist > 0.0) {
    let away = fromTool / toolDist;
    if (params.toolKind == 1u && toolDist < toolRadius) {
      // Stir: velocity is drawn toward the tool's, most strongly at its centre.
      let falloff = 1.0 - toolDist / toolRadius;
      vel = mix(vel, params.toolMotion.xy, clamp(falloff * falloff * strength * dt, 0.0, 1.0));
    } else if (params.toolKind == 2u && toolDist < toolRadius) {
      // Vortex: along the swirl, and toward the centre, fading to its edge.
      let falloff = 1.0 - toolDist / toolRadius;
      let swirl = vec2<f32>(-away.y, away.x);
      accel += (swirl * strength - away * abs(strength) * VORTEX_PULL) * falloff;
    } else if (params.toolKind == 3u) {
      // Shockwave: outward (or inward) across the ring, fading to its edges.
      let band = abs(toolDist - params.toolMotion.z);
      if (band < toolRadius) {
        accel += away * strength * (1.0 - band / toolRadius);
      }
    }
  }

  // The speed limit: no particle moves further than the smallest radius in one
  // substep, so none can pass through another.
  vel = limitLength(vel + accel * dt, params.speedLimit / dt);
  particles[i].vel = vel;
  particles[i].pos = pos + vel * dt;
}
