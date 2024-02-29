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
  bin: array<i32, 20>,
  binSum: array<u32, 16384>,
  binPrefixSum: array<i32, 16384>,
  binIndexTracker: array<i32, 16384>,
  binReindex: array<u32, 20>,
}

struct BinInfoOut {
  bin: array<i32, 20>,
  binSum: array<atomic<u32>, 16384>,
  binPrefixSum: array<i32, 16384>,
  binIndexTracker: array<atomic<i32>, 16384>,
  binReindex: array<u32, 20>,
}

@group(0) @binding(1) var<uniform> params: Params;

@group(1) @binding(0) var<uniform> binParams: BinParams;

@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;
@group(2) @binding(1) var<storage, read_write> binIn: BinInfoIn;
@group(2) @binding(2) var<storage, read_write> binOut: BinInfoOut;

fn oneToTwo(index: i32, gridWidth: i32) -> vec2<i32> {
  var row = index / gridWidth;
  var col = index % gridWidth;
  return vec2(row, col);
}

fn twoToOne(index: vec2<i32> , gridWidth: i32) -> i32 {
  var row = index.y;
  var col = index.x;
  return (row * gridWidth) + col;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = u32(GlobalInvocationID.x);

  if (index >= arrayLength(&verletObjects)) {
    return;
  }

  if (verletObjects[index].colorAndRadius.w == 0) {
    return;
  }

  var bin = binIn.bin[index];
  var useBins = false;
  var useCollide = true;

  var constrainPos = params.constrainCenter.xy;
  var constrainRadius = params.constrainRadius;

  var pos = verletObjects[index].pos.xy;
  var prevPos = verletObjects[index].prevPos.xy;

  var radius = verletObjects[index].colorAndRadius.w;

  // var accel = verletObjects[index].accel.xy;

  // accelerate
  // accel = vec2(0, 270.0);
  var accel = vec2<f32>(0);

  // accelerate
  if (params.clickPoint.x != 0 && params.clickPoint.y != 0) {
    var _pos = params.clickPoint.xy;
    var posDiff = _pos - pos;
    var mag = length(posDiff);
    var invMag2 = 1 / (mag * mag);
    var posDiffNorm = posDiff / mag;
    accel += posDiffNorm * 3000;
  } else {
    accel += vec2(0, 0.0);
  }

  // collide
  var offset = vec2(0.0);
  if (useBins) {
    var binXY = oneToTwo(bin, binParams.x);
    var neighborIndexes = array<i32, 9>(
      bin - binParams.x - 1, bin - binParams.x, bin - binParams.x + 1,
      bin               - 1, bin,               bin               + 1,
      bin + binParams.x - 1, bin + binParams.x, bin + binParams.x + 1
    );

    for (var neighborIndexIndex = 0; neighborIndexIndex < 9; neighborIndexIndex++) {
      var neighborIndex = neighborIndexes[neighborIndexIndex];
      if (neighborIndex < 0 || neighborIndex >= binParams.count) {
        continue;
      }

      for (var i = binIn.binPrefixSum[neighborIndex - 1]; i < binIn.binPrefixSum[neighborIndex]; i++) {
        var otherIndex = binIn.binReindex[i];
        if (otherIndex != index && verletObjects[otherIndex].colorAndRadius.w == 0) {
          var _pos = verletObjects[otherIndex].pos.xy;
          var _radius = verletObjects[otherIndex].colorAndRadius.w;

          var v = pos - _pos;
          var dist2 = (v.x * v.x) + (v.y * v.y);
          var minDist = radius + _radius;
          if (dist2 < minDist * minDist) {
            var dist = sqrt(dist2);
            var n = v / dist;

            var massRatio = 0.5;
            var responseCoef = 0.65;
            var delta = 0.5 * responseCoef * (dist - minDist);
            offset += n * (massRatio * delta);
          }
        }
      }
    }
  } else if (useCollide) {
    for (var i = 0u; i < arrayLength(&verletObjects); i++) {
      if (i == index || verletObjects[i].colorAndRadius.w == 0) {
        continue;
      }

      var _pos = verletObjects[i].pos.xy;
      var _radius = verletObjects[i].colorAndRadius.w;

      var v = pos - _pos;
      var dist2 = (v.x * v.x) + (v.y * v.y);
      var minDist = radius + _radius;
      if (dist2 < minDist * minDist) {
        var dist = sqrt(dist2);
        var n = v / dist;

        var massRatio = 0.5;
        var responseCoef = 2.0;
        var delta = 0.5 * responseCoef * (dist - minDist);
        offset += n * (massRatio * delta);
      }
    }
  }

  pos -= offset;
  
  // constrain
  {
    var v = constrainPos - pos;
    var dist = length(v);
    if (dist > constrainRadius - radius) {
      var constrainVec = normalize(vec2f(-pos.xy));
      var n = v / dist;
      pos = constrainPos - (n * (constrainRadius - radius));

      var prevVec = prevPos - pos;
      prevVec *= 1;
      // prevPos = pos + prevVec;
      prevPos = (pos - constrainVec * 2);
    }
  }

  // update
  {
    var velocity = pos - prevPos;
    prevPos = pos;
    pos = pos + velocity + (accel * (params.deltaTime / 100000));
  }

  // load back
  {
    // verletObjects[index].accel = vec4(0);
    verletObjects[index].pos = vec4(pos.xy, 0, 0);
    verletObjects[index].prevPos = vec4(prevPos.xy, 0, 0);

    var binx = i32((pos.x + (f32(params.boxDim) / 2.0)) / f32(binParams.size));
    var biny = i32((pos.y + (f32(params.boxDim) / 2.0)) / f32(binParams.size));
    var binIndex = twoToOne(vec2<i32>(binx, biny), binParams.x);
    binOut.bin[index] = binIndex;
  }
}

@compute @workgroup_size(64)
fn binSum(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = u32(GlobalInvocationID.x);

  if (index < u32(binParams.count)) {
    atomicStore(&binOut.binSum[index], 0u);
  }

  storageBarrier();

  if (index < arrayLength(&verletObjects)) {
    atomicAdd(&binOut.binSum[binIn.bin[index]], 1u);
  }
}

@compute @workgroup_size(64)
fn binPrefixSum(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = i32(GlobalInvocationID.x);

  // if (index >= binParams.count) {
  //   return;
  // }

  binOut.binPrefixSum[index] = 0;

  for (var i = 0; i <= index; i++) {
    binOut.binPrefixSum[index] += i32(binIn.binSum[i]);
  }

  storageBarrier();

  atomicStore(&binOut.binIndexTracker[index], 0);
  if (index > 0) {
    atomicStore(&binOut.binIndexTracker[index], binIn.binPrefixSum[index - 1]);
  }
}

@compute @workgroup_size(64)
fn binReindex(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = u32(GlobalInvocationID.x);

  if (index >= arrayLength(&verletObjects)) {
    return;
  }

  var bin = binIn.bin[index];

  var lastIndex = atomicAdd(&binOut.binIndexTracker[bin], 1);
  binOut.binReindex[lastIndex] = index;
}