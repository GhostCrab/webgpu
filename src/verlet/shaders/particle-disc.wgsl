// The parts of drawing a particle that both pipelines share: the projection,
// and the fragment shader that cuts each instanced quad to a disc. Each
// pipeline's renderer shader appends its own vertex_main (see
// verlet-renderer.ts).

@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) fragUV: vec2<f32>,
  @location(2) @interpolate(flat) cull: u32,
}

// The vertex output of a particle that is not drawn.
fn culled() -> VertexOutput {
  return VertexOutput(vec4f(0), vec4f(0), vec2f(0), 1);
}

// Places a corner of the unit quad for a particle at `center` of `radius`. The
// quad is 1.25x the radius, so neighbouring discs overlap slightly.
fn discCorner(corner: vec4<f32>, center: vec2<f32>, radius: f32, color: vec3<f32>, uv: vec2<f32>) -> VertexOutput {
  let pos = vec4f(corner.xy * radius * 1.25 + center, corner.zw);
  return VertexOutput(mvp * pos, vec4f(color, 1), uv, 0);
}

@fragment
fn fragment_main(
    @location(0) color : vec4<f32>,
    @location(1) fragUV : vec2<f32>,
    @location(2) @interpolate(flat) cull : u32
  ) -> @location(0) vec4f {
  if (cull == 1) {discard;};

  if (length(fragUV - 0.5) > 0.5) {
    discard;
  }

  return color;
}
