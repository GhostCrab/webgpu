@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4f {
    return vec4f(uv, 0, 1);
}
