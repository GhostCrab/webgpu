// The current pipeline's particle, read as per-instance vertex attributes.
// Appended to particle-disc.wgsl.
@vertex
fn vertex_main(
  @location(0) position: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) i_pos: vec4<f32>,
  @location(3) i_color_and_radius: vec4<f32>
) -> VertexOutput {
  if (i_color_and_radius.w == 0) {
    return culled();
  }
  return discCorner(position, i_pos.xy, i_color_and_radius.w, i_color_and_radius.xyz, uv);
}
