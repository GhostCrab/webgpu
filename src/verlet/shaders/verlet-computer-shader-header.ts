export function computeShaderHeader() {
  return `
  struct Params {
    totalTime: f32,
    deltaTime: f32,
    constrainRadius: f32,
    boxDim: f32,
    constrainType: u32,
    unused1: u32,
    unused2: u32,
    unused3: u32,
    constrainCenter: vec4<f32>,
    clickPoint: vec4<f32>,
  };
  
  struct VerletObject {
    pos: vec4<f32>,
    prevPos: vec4<f32>,
    accel: vec4<f32>,
    colorAndRadius: vec4<f32>,
    binLink: i32,
    unused1: f32,
    unused2: f32,
    unused3: f32,
  }

  struct VerletObjectAtomicBin {
    pos: vec4<f32>,
    prevPos: vec4<f32>,
    accel: vec4<f32>,
    colorAndRadius: vec4<f32>,
    binLink: atomic<i32>,
    unused1: f32,
    unused2: f32,
    unused3: f32,
  }

  struct BinParams {
    size: i32,
    x: i32,
    y: i32,
    count: u32,
    offset: u32,
    stride: u32
  }

  @group(0) @binding(1) var<uniform> params: Params;
  @group(1) @binding(0) var<uniform> binParams: BinParams;
  `;
}