struct SimParams {
  totalTime: f32,
  deltaTime: f32,
  constrainRadius: f32,
  boxDim: f32,
  constrainCenter: vec4<f32>,
  clickPoint: vec4<f32>,
};

@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;
@group(0) @binding(1) var<uniform> simParams: SimParams;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn main(@location(0) inPos: vec4<f32>,
        @location(1) uv: vec2<f32>) -> VSOut {
  var rotMatrix = mat4x4<f32>(
    cos(simParams.totalTime), -sin(simParams.totalTime), 0, 0,
    sin(simParams.totalTime), cos(simParams.totalTime), 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  var scaleMatrix = mat4x4<f32>(
    300, 0, 0, 0,
    0, 300, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );
  var vsOut: VSOut;
  vsOut.position = (mvp * (scaleMatrix * (rotMatrix * inPos)));
  vsOut.uv = uv;
  return vsOut;
}
