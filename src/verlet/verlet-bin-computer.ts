import { vec2 } from 'wgpu-matrix';

import { Verlet } from './verlet';

import { computeShaderHeader } from './shaders/verlet-computer-shader-header';

import applyForcesShaderCode from './shaders/apply-forces.wgsl';
// import collideShaderCode from './shaders/collide.wgsl';
import collideShaderCode from './shaders/bin-collide.wgsl';
import constrainShaderCode from './shaders/constrain.wgsl';
import integrateShaderCode from './shaders/integrate.wgsl';

import binClearShaderCode from './shaders/bin-clear.wgsl';
import binSumShaderCode from './shaders/bin-sum.wgsl';
import binPrefixSumShaderCode from './shaders/bin-prefix-sum.wgsl';
import binIndexTrackShaderCode from './shaders/bin-index-track.wgsl';
import binReindexShaderCode from './shaders/bin-reindex.wgsl';

export class VerletBinComputer {
  uniformBindGroupLayout: GPUBindGroupLayout;
  storageBindGroupLayout: GPUBindGroupLayout;
  pipelineLayout: GPUPipelineLayout;

  applyForcesPipeline: GPUComputePipeline;
  collidePipeline: GPUComputePipeline;
  constrainPipeline: GPUComputePipeline;
  integratePipeline: GPUComputePipeline;

  binClearPipeline: GPUComputePipeline;
  binSumPipeline: GPUComputePipeline;
  binPrefixSumPipeline: GPUComputePipeline;
  binIndexTrackPipeline: GPUComputePipeline;
  binReindexPipeline: GPUComputePipeline;

  applyForcesShaderModule: GPUShaderModule;
  collideShaderModule: GPUShaderModule;
  constrainShaderModule: GPUShaderModule;
  integrateShaderModule: GPUShaderModule;

  binClearShaderModule: GPUShaderModule;
  binSumShaderModule: GPUShaderModule;
  binPrefixSumShaderModule: GPUShaderModule;
  binIndexTrackShaderModule: GPUShaderModule;
  binReindexShaderModule: GPUShaderModule;

  passDescriptor: GPUComputePassDescriptor;

  // buffer data
  objectCount: number;

  binParams: Uint32Array;

  binParamsBufferSize: number;
  binParamsBuffer: GPUBuffer;

  binData: Int32Array
  binBufferSize: number;
  binBufferOffset: number;

  binSumData: Uint32Array;
  binSumBufferSize: number;
  binSumBufferOffset: number;

  binPrefixSumData: Int32Array;
  binPrefixSumBufferSize: number;
  binPrefixSumBufferOffset: number;

  binIndexTrackerData: Int32Array;
  binIndexTrackerBufferSize: number;
  binIndexTrackerBufferOffset: number;

  binReindexData: Uint32Array;
  binReindexBufferSize: number;
  binReindexBufferOffset: number;

  binInfoBufferSize: number;
  binInfoBuffer: GPUBuffer;

  binReadBuffer: GPUBuffer;

  uniformBindGroup: GPUBindGroup;
  storageBindGroup: GPUBindGroup;

  constructor(globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice, objectCount: number) {
    this.binClearShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + binClearShaderCode
    });

    this.binSumShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + binSumShaderCode
    });

    this.binPrefixSumShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + binPrefixSumShaderCode
    });

    this.binIndexTrackShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + binIndexTrackShaderCode
    });

    this.binReindexShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + binReindexShaderCode
    });

    this.applyForcesShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + applyForcesShaderCode
    });

    this.collideShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + collideShaderCode
    });

    this.constrainShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + constrainShaderCode
    });

    this.integrateShaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount, 4096) + integrateShaderCode
    });

    this.uniformBindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0, // binParams
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' }
      }]
    });

    this.storageBindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0, // verletObjects
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      }, {
        binding: 1, // binInfo
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      }]
    });

    const computePipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        globalUniformBindGroupLayout, // @group(0)
        this.uniformBindGroupLayout,  // @group(1)
        this.storageBindGroupLayout,  // @group(2)
      ]
    });

    this.binClearPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.binClearShaderModule,
        entryPoint: 'main',
      },
    });

    this.binSumPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.binSumShaderModule,
        entryPoint: 'main',
      },
    });

    this.binPrefixSumPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.binPrefixSumShaderModule,
        entryPoint: 'main',
      },
    });

    this.binIndexTrackPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.binIndexTrackShaderModule,
        entryPoint: 'main',
      },
    });

    this.binReindexPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.binReindexShaderModule,
        entryPoint: 'main',
      },
    });

    this.applyForcesPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.applyForcesShaderModule,
        entryPoint: 'main',
      },
    });

    this.collidePipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.collideShaderModule,
        entryPoint: 'main',
      },
    });

    this.constrainPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.constrainShaderModule,
        entryPoint: 'main',
      },
    });

    this.integratePipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.integrateShaderModule,
        entryPoint: 'main',
      },
    });

    this.passDescriptor = {};
  }

  initBuffers(device: GPUDevice,
              bounds: number,
              objectCount: number,
              voDataArray: Float32Array,
              voDataArrayStride: number,
              voBuffer: GPUBuffer) {
    this.objectCount = objectCount;
    const gridPixelDim = bounds;
    const binParamsArrayLength = 4;

    // const binSquareSize = voDataArray[15] * 2;
    // const binGridWidth = Math.ceil((gridPixelDim / binSquareSize) / 2) * 2;
    // const binGridHeight = Math.ceil((gridPixelDim / binSquareSize) / 2) * 2;
    // const binGridSquareCount = Math.ceil((binGridWidth * binGridHeight) / 4) * 4;

    // const binGridWidth = 32;
    // const binGridHeight = 32;
    // const binSquareSize = Math.ceil(gridPixelDim / 32);
    // const binGridSquareCount = Math.ceil((binGridWidth * binGridHeight) / 4) * 4;
    
    const binResolution = 64;
    const binGridWidth = binResolution;
    const binGridHeight = binResolution;
    const binSquareSize = Math.ceil(gridPixelDim / binResolution);
    const binGridSquareCount = Math.ceil((binGridWidth * binGridHeight) / 4) * 4;
    
    console.log(`gridPixelDim:${gridPixelDim}, binGridWidth:${binGridWidth}, binSquareSize:${binSquareSize}, binGridSquareCount: ${binGridSquareCount}`);
    
    this.binParams = new Uint32Array([
      binSquareSize,     // bin square size
      binGridWidth,      // grid width
      binGridHeight,     // grid height
      binGridSquareCount // number of grid squares
    ]);

    this.binParamsBufferSize = binParamsArrayLength * Uint32Array.BYTES_PER_ELEMENT;
    this.binParamsBuffer = device.createBuffer({
      size: this.binParamsBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.binParamsBuffer.getMappedRange()).set(this.binParams);
    this.binParamsBuffer.unmap();

    // binData: Int32Array
    this.binData = new Int32Array(objectCount);
    this.binBufferSize = this.binData.byteLength;
    this.binBufferOffset = 0;

    // binSumData: Uint32Array;
    this.binSumData = new Uint32Array(binGridSquareCount);
    this.binSumBufferSize = this.binSumData.byteLength;
    this.binSumBufferOffset = this.binBufferOffset + this.binBufferSize;

    // binPrefixSumData: Int32Array;
    this.binPrefixSumData = new Int32Array(binGridSquareCount);
    this.binPrefixSumBufferSize = this.binPrefixSumData.byteLength;
    this.binPrefixSumBufferOffset = this.binSumBufferOffset + this.binSumBufferSize;

    // binIndexTrackerData: Int32Array;
    this.binIndexTrackerData = new Int32Array(binGridSquareCount);
    this.binIndexTrackerBufferSize = this.binIndexTrackerData.byteLength;
    this.binIndexTrackerBufferOffset = this.binPrefixSumBufferOffset + this.binPrefixSumBufferSize;

    // binReindexData: Uint32Array;
    this.binReindexData = new Uint32Array(objectCount);
    this.binReindexBufferSize = this.binReindexData.byteLength;
    this.binReindexBufferOffset = this.binIndexTrackerBufferOffset + this.binIndexTrackerBufferSize;

    // populate this.binData with initial vo positions
    for (let i = 0; i < objectCount; i++) {
      const xpos = voDataArray[(i * voDataArrayStride)];
      const ypos = voDataArray[(i * voDataArrayStride) + 1];

      
      const binx = Math.floor((xpos + (bounds / 2)) / binSquareSize);
      const biny = Math.floor((ypos + (bounds / 2)) / binSquareSize);
      
      this.binData[i] = (biny * binGridWidth) + binx;
    }

    // console.log(this.binData);
    // console.log(`${bounds} ${binSquareSize} ${binGridWidth}`);

    this.binInfoBufferSize = this.binReindexBufferOffset + this.binReindexBufferSize;
    this.binInfoBuffer = device.createBuffer({
      size: this.binInfoBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.binInfoBuffer.getMappedRange(this.binBufferOffset, this.binBufferSize)).set(this.binData);
    this.binInfoBuffer.unmap();

    this.binReadBuffer = device.createBuffer({
      size: this.binBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    this.uniformBindGroup = device.createBindGroup({
      layout: this.binSumPipeline.getBindGroupLayout(1),
      entries: [{
          binding: 0,
          resource: { buffer: this.binParamsBuffer },
        }
      ]
    });

    this.storageBindGroup = device.createBindGroup({
      layout: this.binSumPipeline.getBindGroupLayout(2),
      entries: [{
          binding: 0,
          resource: {
            buffer: voBuffer,
            offset: 0,
            size: voBuffer.size,
          },
        }, {
          binding: 1,
          resource: {
            buffer: this.binInfoBuffer,
            offset: 0,
            size: this.binInfoBufferSize,
          },
        }
      ],
    });
  }

  doBinning() {
    // console.log(this.binData);

    // START BINNING
    // clear binSum
    this.binSumData.forEach((bs, index) => {this.binSumData[index] = 0;});

    // increment binSum cell for each object in that cell
    this.binData.forEach((b, index) => {this.binSumData[b]++;});

    // fill out prefix sum cell with accumulated object count for each cell
    let prefixSum = 0;
    this.binPrefixSumData.forEach((ps, index) => {
      prefixSum += this.binSumData[index];
      this.binPrefixSumData[index] = prefixSum;
    });

    this.binIndexTrackerData.forEach((bit, index) => {
      if (index > 0) {
        this.binIndexTrackerData[index] = this.binPrefixSumData[index - 1];  
      } else {
        this.binIndexTrackerData[index] = 0;
      }
    });

    this.binData.forEach((b, index) => {
      const lastIndex = this.binIndexTrackerData[b];
      this.binIndexTrackerData[b]++;
      this.binReindexData[lastIndex] = index;
    });
    // END BINNING
  }

  async compute(device: GPUDevice, commandEncoder: GPUCommandEncoder, globalUniformBindGroup: GPUBindGroup) {
    const voWorkgroupCount = Math.ceil(this.objectCount / 64);
    const binWorkgroupCount = Math.ceil(this.binParams[3] / 64);

    let passEncoder = commandEncoder.beginComputePass();
    passEncoder.setBindGroup(0, globalUniformBindGroup);
    passEncoder.setBindGroup(1, this.uniformBindGroup);
    passEncoder.setBindGroup(2, this.storageBindGroup);

    // binning
    passEncoder.setPipeline(this.binClearPipeline);
    passEncoder.dispatchWorkgroups(binWorkgroupCount);

    passEncoder.setPipeline(this.binSumPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.setPipeline(this.binPrefixSumPipeline);
    passEncoder.dispatchWorkgroups(Math.ceil(this.binParams[3] / 16), Math.ceil(this.binParams[3] / 16));

    passEncoder.setPipeline(this.binIndexTrackPipeline);
    passEncoder.dispatchWorkgroups(binWorkgroupCount);

    passEncoder.setPipeline(this.binReindexPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    // verlet integration
    passEncoder.setPipeline(this.applyForcesPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.setPipeline(this.collidePipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.setPipeline(this.constrainPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.setPipeline(this.integratePipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.end();   
  }

  computeCPU(verletObjs: Verlet, simParams: Float32Array) {
    // populate binData with updated data from verlet objects
    for (let index = 0; index < verletObjs.objectCount * verletObjs.dataNumFloats; ) {
      const posx = verletObjs.dataArray[index];
      const posy = verletObjs.dataArray[index+1];

      // var binx = i32((pos.x + (f32(params.boxDim) / 2.0)) / f32(binParams.size));
      const binx = Math.floor((posx + (simParams[3] / 2)) / this.binParams[0]);
      // var biny = i32((pos.y + (f32(params.boxDim) / 2.0)) / f32(binParams.size));
      const biny = Math.floor((posy + (simParams[3] / 2)) / this.binParams[0]);
      // binOut.bin[index] = binIndex;
      this.binData[Math.floor(index / verletObjs.dataNumFloats)] = (biny * this.binParams[1]) + binx;

      index += verletObjs.dataNumFloats;
    }

    this.doBinning();

    const constrainCenter = vec2.create(simParams[4], simParams[5]);
    const constrainRadius = simParams[2];

    const dt = simParams[1];

    // apply gravity
    for (let index = 0; index < verletObjs.objectCount * verletObjs.dataNumFloats; ) {
      verletObjs.dataArray[index + 9] = 450;

      index += verletObjs.dataNumFloats;
    }

    // for each bin, collide objects in bin with other objects in the same and neighboring bin
    for (let binIndex = 0; binIndex < this.binParams[3]; binIndex++) {
      const neighborIndexes = [
        binIndex - this.binParams[1] - 1, binIndex - this.binParams[1], binIndex - this.binParams[1] + 1,
        binIndex                     - 1, binIndex,                     binIndex                     + 1,
        binIndex + this.binParams[1] - 1, binIndex + this.binParams[1], binIndex + this.binParams[1] + 1,
      ];

      let startSelfIndex = this.binPrefixSumData[binIndex - 1];
      if (binIndex === 0)
        startSelfIndex = 0;

      for (let i = startSelfIndex; i < this.binPrefixSumData[binIndex]; i++) {
        const index = this.binReindexData[i] * verletObjs.dataNumFloats;
    
        const pos = vec2.create(verletObjs.dataArray[index], verletObjs.dataArray[index + 1]);
        const radius = verletObjs.dataArray[index + 15];
        
        let offset = vec2.create(0,0);

        for (let neighborIndexIndex = 0; neighborIndexIndex < 9; neighborIndexIndex++) {
          let neighborIndex = neighborIndexes[neighborIndexIndex];
          if (neighborIndex < 0 || neighborIndex >= this.binParams[3]) {
            continue;
          }

          let startOtherIndex = this.binPrefixSumData[neighborIndex - 1];
          if (neighborIndex === 0)
            startOtherIndex = 0;
    
          for (var j = startOtherIndex; j < this.binPrefixSumData[neighborIndex]; j++) {
            const otherIndex = this.binReindexData[j] * verletObjs.dataNumFloats;
            const otherRadius = verletObjs.dataArray[otherIndex + 15];
            if (otherIndex != index && otherRadius !== 0) {
              const otherPos = vec2.create(verletObjs.dataArray[otherIndex], verletObjs.dataArray[otherIndex + 1]);
              // console.log(`Testing ${index} [${pos[0].toFixed(0)} ${pos[1].toFixed(0)}] <=> ${otherIndex} [${otherPos[0].toFixed(0)} ${otherPos[1].toFixed(0)}]`);
              
              const v = vec2.sub(pos, otherPos);
              const dist2 = vec2.lenSq(v);
              const minDist = radius + otherRadius;
              if (dist2 < minDist * minDist) {
                const dist = Math.sqrt(dist2);
                const n = vec2.scale(v, 1 / dist);
      
                const massRatio = 0.5;
                const responseCoef = 0.65;
                const delta = 0.5 * responseCoef * (dist - minDist);
                vec2.addScaled(offset, n, -massRatio * delta, offset);
              }
            }
          } 
        }

        // write back data
        verletObjs.dataArray[index + 16] = offset[0];
        verletObjs.dataArray[index + 17] = offset[1];
      }
    }

    // apply collision offsets
    for (let index = 0; index < verletObjs.objectCount * verletObjs.dataNumFloats; ) {
      verletObjs.dataArray[index] += verletObjs.dataArray[index + 16];
      verletObjs.dataArray[index + 1] += verletObjs.dataArray[index + 17];

      verletObjs.dataArray[index + 16] = 0;
      verletObjs.dataArray[index + 17] = 0;

      index += verletObjs.dataNumFloats;
    }

    // apply constraints
    for (let index = 0; index < verletObjs.objectCount * verletObjs.dataNumFloats; ) {
      let pos = vec2.create(verletObjs.dataArray[index], verletObjs.dataArray[index + 1]);
      let prevPos = vec2.create(verletObjs.dataArray[index + 4], verletObjs.dataArray[index + 5]);
      const radius = verletObjs.dataArray[index + 15];

      const v = vec2.sub(constrainCenter, pos);
      const dist = vec2.len(v);
      if (dist > constrainRadius - radius) {
        const n = vec2.scale(v, 1 / dist);
        const constrainPos = vec2.sub(constrainCenter, vec2.scale(n, constrainRadius - radius));

        const prevVec = vec2.sub(prevPos, pos);
        const prevVecLen = vec2.len(prevVec);

        const constrainVec = vec2.sub(prevPos, constrainPos);
        const constrainVecLen = vec2.len(constrainVec);

        // this is how far past constrainPos the vector between fakePrevPos and bouncedPos needs to be
        const bounceVecLen = constrainVecLen - prevVecLen;

        const reflectNormal = vec2.normalize(vec2.negate(pos));
        const oldVelo = vec2.sub(pos, prevPos);

        // calculate the reflect vector
        const newVelo = vec2.sub(oldVelo, vec2.scale(reflectNormal, 2 * vec2.dot(reflectNormal, oldVelo)));
        pos = vec2.addScaled(constrainPos, newVelo, bounceVecLen);
        prevPos = vec2.addScaled(pos, newVelo, -0.7);

        // write data back
        verletObjs.dataArray[index] = pos[0];
        verletObjs.dataArray[index + 1] = pos[1];
        
        verletObjs.dataArray[index + 4] = prevPos[0];
        verletObjs.dataArray[index + 5] = prevPos[1];
      }

      index += verletObjs.dataNumFloats;
    }

    // apply verlet integration
    for (let index = 0; index < verletObjs.objectCount * verletObjs.dataNumFloats; ) {
      let pos = vec2.create(verletObjs.dataArray[index], verletObjs.dataArray[index + 1]);
      let prevPos = vec2.create(verletObjs.dataArray[index + 4], verletObjs.dataArray[index + 5]);
      let accel = vec2.create(verletObjs.dataArray[index + 8], verletObjs.dataArray[index + 9]);

      const velocity = vec2.subtract(pos, prevPos);
      const offset = vec2.addScaled(velocity, accel, dt * dt);

      // write back data
      // pos
      verletObjs.dataArray[index] = pos[0] + offset[0];
      verletObjs.dataArray[index + 1] = pos[1] + offset[1];
      
      // prevpos = pos
      verletObjs.dataArray[index + 4] = pos[0];
      verletObjs.dataArray[index + 5] = pos[1];

      // zero out acceleration
      verletObjs.dataArray[index + 8]  = 0;
      verletObjs.dataArray[index + 9]  = 0;
      verletObjs.dataArray[index + 10] = 0;
      verletObjs.dataArray[index + 11] = 0;

      index += verletObjs.dataNumFloats;
    }
  }
}