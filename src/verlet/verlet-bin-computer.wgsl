@group(0) @binding(1) var<uniform> params: Params;

@group(1) @binding(0) var<uniform> binParams: BinParams;

@group(2) @binding(0) var<storage, read_write> verletObjects: array<VerletObject>;
@group(2) @binding(1) var<storage, read> binIn: BinInfoIn;
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

fn hash11(p: f32) -> f32 {
  var next = fract(p * .1031);
  next *= next + 33.33;
  next *= next + next;
  return fract(next);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var binIndex = i32(GlobalInvocationID.x);

  // if (binIndex >= arrayLength(&binIn.binSum)) {
  if (binIndex >= 16384) {
    return;
  }

  var neighborIndexes = array<i32, 9>(
    binIndex - binParams.x - 1, binIndex - binParams.x, binIndex - binParams.x + 1,
    binIndex               - 1, binIndex,               binIndex               + 1,
    binIndex + binParams.x - 1, binIndex + binParams.x, binIndex + binParams.x + 1
  );

  var constrainCenter = params.constrainCenter.xy;
  var constrainRadius = params.constrainRadius;

  // iterate over all objects in the current binIndex
  for (var i = binIn.binPrefixSum[binIndex - 1]; i < binIn.binPrefixSum[binIndex]; i++) {
    var index = binIn.binReindex[i];

    var pos = verletObjects[index].pos.xy;
    var prevPos = verletObjects[index].prevPos.xy;

    // // sometimes accelerate a particle to add FUN
    // if (hash11((params.totalTime * f32(index))) > 0.9999) {
    //   var velocityDir = normalize(pos - prevPos);
    //   prevPos = pos - (velocityDir * 5.0);
    // }

    // var radius = verletObjects[index].colorAndRadius.w;

    // // var accel = verletObjects[index].accel.xy;
    // var accel = vec2<f32>(0, 50.0);

    // // accelerate
    // if (params.clickPoint.x != 0 && params.clickPoint.y != 0) {
    //   var _pos = params.clickPoint.xy;
    //   var posDiff = _pos - pos;
    //   var mag = length(posDiff);
    //   var invMag2 = 1 / (mag * mag);
    //   var posDiffNorm = posDiff / mag;
    //   accel = posDiffNorm * 300;
    // } else {
    //   accel += vec2<f32>(0, 0.0);
    // }

    // // collide
    // var offset = vec2(0.0);

    // for (var neighborIndexIndex = 0; neighborIndexIndex < 9; neighborIndexIndex++) {
    //   var neighborIndex = neighborIndexes[neighborIndexIndex];
    //   if (neighborIndex < 0 || neighborIndex >= binParams.count) {
    //     continue;
    //   }

    //   for (var i = binIn.binPrefixSum[neighborIndex - 1]; i < binIn.binPrefixSum[neighborIndex]; i++) {
    //     var otherIndex = binIn.binReindex[i];
    //     if (otherIndex != index && verletObjects[otherIndex].colorAndRadius.w == 0) {
    //       var _pos = verletObjects[otherIndex].pos.xy;
    //       var _radius = verletObjects[otherIndex].colorAndRadius.w;

    //       var v = pos - _pos;
    //       var dist2 = (v.x * v.x) + (v.y * v.y);
    //       var minDist = radius + _radius;
    //       if (dist2 < minDist * minDist) {
    //         var dist = sqrt(dist2);
    //         var n = v / dist;

    //         var massRatio = 0.5;
    //         var responseCoef = 0.65;
    //         var delta = 0.5 * responseCoef * (dist - minDist);
    //         offset += n * (massRatio * delta);
    //       }
    //     }
    //   }
    // }
    
    // pos -= offset;
  
    // // constrain
    // {
    //   var v = constrainCenter - pos;
    //   var dist = length(v);
    //   if (dist > constrainRadius - radius) {
    //     var n = v / dist;
    //     var constrainPos = constrainCenter - (n * (constrainRadius - radius));

    //     var prevVec = prevPos - pos;
    //     var prevVecLen = length(prevVec);

    //     var constrainVec = prevPos - constrainPos;
    //     var constrainVecLen = length(constrainVec);

    //     // this is how far past constrainPos the vector between fakePrevPos and bouncedPos needs to be
    //     var bounceVecLen = constrainVecLen - prevVecLen;

    //     var reflectNormal = normalize(vec2f(-pos.xy));
    //     var oldVelo = pos - prevPos;


    //     // calculate the reflect vector
    //     var newVelo = reflect(oldVelo, reflectNormal);
    //     pos = constrainPos + (newVelo * bounceVecLen);
    //     prevPos = pos - (newVelo);
        
    //   }
    // }

    // // update
    // {
    //   var velocity = pos - prevPos;
    //   prevPos = pos;
    //   pos = pos + velocity + (accel * (params.deltaTime * params.deltaTime));
    // }

    // load back
    {
      pos.y = pos.y + 1;
      // verletObjects[index].accel = vec4(0);
      verletObjects[index].pos = vec4(pos.xy, 0, 0);
      verletObjects[index].prevPos = vec4(prevPos.xy, 0, 0);

      var binx = i32((pos.x + (f32(params.boxDim) / 2.0)) / f32(binParams.size));
      var biny = i32((pos.y + (f32(params.boxDim) / 2.0)) / f32(binParams.size));
      var binIndex = twoToOne(vec2<i32>(binx, biny), binParams.x);
      // binOut.bin[index] = binIndex;
      binOut.bin[index] = i32(binIn.binReindex[i]);
    }
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