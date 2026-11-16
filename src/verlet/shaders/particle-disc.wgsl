// Draws each particle as an instanced quad cut to a disc, straight to the
// canvas. The particle buffer is read as per-instance vertex attributes, and
// each particle's colour is read from the colour buffer at the same place.
// There is no multisampling: the disc's edge is smoothed here instead.

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
  @builtin(instance_index) instance: u32
) -> VertexOutput {
  // A disabled or erased particle is not drawn.
  if (i_radius <= 0) {
    return VertexOutput(vec4f(0), vec4f(0), vec2f(0), 1);
  }
  // The quad is 1.25x the radius, so neighbouring discs overlap slightly.
  let pos = vec4f(corner.xy * i_radius * 1.25 + i_pos, corner.zw);
  let color = unpack4x8unorm(colors[instance]).rgb;
  return VertexOutput(mvp * pos, vec4f(color, 1), uv, 0);
}

@fragment
fn fragment_main(
    @location(0) color : vec4<f32>,
    @location(1) fragUV : vec2<f32>,
    @location(2) @interpolate(flat) cull : u32
  ) -> @location(0) vec4f {
  // Distance from the disc's centre, 1 at its edge.
  let fromCentre = length(fragUV - 0.5) * 2;
  // How far that changes across one pixel. Taken before any discard,
  // since derivatives need every fragment of the quad.
  let perPixel = max(fwidth(fromCentre), 1e-6);

  if (cull == 1) {discard;};

  // The share of the pixel the disc covers, approximately: opaque from half a
  // pixel inside the edge, half at the edge. The quad ends at the edge, so the
  // outer half pixel of the fade is cut off all round, corners included. A
  // disc under a pixel across stays about as bright as its area.
  if (fromCentre > 1) {
    discard;
  }
  let coverage = clamp((1 - fromCentre) / perPixel + 0.5, 0, 1);

  return vec4f(color.rgb, coverage);
}
