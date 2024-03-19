export function computeShaderHeader(objectCount: number, binCount: number) {
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
    collisionOffset: vec4<f32>
  }

  struct VerletObjectCollide {
    pos: vec4<f32>,
    prevPos: vec4<f32>,
    accel: vec4<f32>,
    colorAndRadius: vec4<f32>,
    collisionOffset: array<atomic<u32>, 4>,
  }
  
  struct BinParams {
    size: i32,
    x: i32,
    y: i32,
    count: u32,
  }

  struct BinInfo {
    bin: array<i32, ${objectCount}>,
    binSum: array<u32, ${binCount}>,
    binPrefixSum: array<i32, ${binCount}>,
    binIndexTracker: array<i32, ${binCount}>,
    binReindex: array<u32, ${objectCount}>,
  }
  
  struct BinSumInfo {
    bin: array<i32, ${objectCount}>,
    binSum: array<atomic<u32>, ${binCount}>,
    binPrefixSum: array<i32, ${binCount}>,
    binIndexTracker: array<i32, ${binCount}>,
    binReindex: array<u32, ${objectCount}>,
  }

  struct BinPrefixSumInfo {
    bin: array<i32, ${objectCount}>,
    binSum: array<u32, ${binCount}>,
    binPrefixSum: array<atomic<i32>, ${binCount}>,
    binIndexTracker: array<i32, ${binCount}>,
    binReindex: array<u32, ${objectCount}>,
  }

  struct BinReindexInfo {
    bin: array<i32, ${objectCount}>,
    binSum: array<u32, ${binCount}>,
    binPrefixSum: array<i32, ${binCount}>,
    binIndexTracker: array<atomic<i32>, ${binCount}>,
    binReindex: array<u32, ${objectCount}>,
  }

  @group(0) @binding(1) var<uniform> params: Params;
  @group(1) @binding(0) var<uniform> binParams: BinParams;
  `;
}