export function computeShaderHeader(objectCount: number) {
  return `
  struct Params {
    totalTime: f32,
    deltaTime: f32,
    constrainRadius: f32,
    boxDim: f32,
    constrainCenter: vec4<f32>,
    clickPoint: vec4<f32>,
  };
  
  struct VerletObject {
    pos: vec4<f32>,
    prevPos: vec4<f32>,
    accel: vec4<f32>,
    colorAndRadius: vec4<f32>,
  }
  
  struct BinParams {
    size: i32,
    x: i32,
    y: i32,
    count: i32,
  }
  
  struct BinInfoIn {
    bin: array<i32, ${objectCount}>,
    binSum: array<u32, 16384>,
    binPrefixSum: array<i32, 16384>,
    binIndexTracker: array<i32, 16384>,
    binReindex: array<u32, ${objectCount}>,
  }
  
  struct BinInfoOut {
    bin: array<i32, ${objectCount}>,
    binSum: array<atomic<u32>, 16384>,
    binPrefixSum: array<i32, 16384>,
    binIndexTracker: array<atomic<i32>, 16384>,
    binReindex: array<u32, ${objectCount}>,
  }
  `;
}