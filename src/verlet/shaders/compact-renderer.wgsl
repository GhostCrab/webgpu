// The new pipeline's particle, read as per-instance vertex attributes, with its
// colour looked up by particle id. Appended to particle-disc.wgsl.
@group(0) @binding(1) var<storage, read> colors: array<u32>;

@vertex
fn vertex_main(
  @location(0) position: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) i_pos: vec2<f32>,
  @location(3) i_radius: f32,
  @location(4) i_id: u32
) -> VertexOutput {
  if (i_radius == 0) {
    return culled();
  }
  return discCorner(position, i_pos, i_radius, unpack4x8unorm(colors[i_id]).rgb, uv);
}
