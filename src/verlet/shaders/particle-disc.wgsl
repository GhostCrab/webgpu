// Draws each particle as an instanced quad cut to a disc. The particle buffer
// is read as per-instance vertex attributes, and each particle's colour is
// looked up in the colour buffer by particle id.

@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;
@group(0) @binding(1) var<storage, read> colors: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) fragUV: vec2<f32>,
  @location(2) @interpolate(flat) cull: u32,
}

@vertex
fn vertex_main(
  @location(0) corner: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) i_pos: vec2<f32>,
  @location(3) i_radius: f32,
  @location(4) i_id: u32
) -> VertexOutput {
  // A disabled particle is not drawn.
  if (i_radius == 0) {
    return VertexOutput(vec4f(0), vec4f(0), vec2f(0), 1);
  }
  // The quad is 1.25x the radius, so neighbouring discs overlap slightly.
  let pos = vec4f(corner.xy * i_radius * 1.25 + i_pos, corner.zw);
  let color = unpack4x8unorm(colors[i_id]).rgb;
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
