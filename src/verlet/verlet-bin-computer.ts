import { computeShaderHeader } from './verlet-computer-shader-header';
import shaderCode from './verlet-bin-computer.wgsl';

export class VerletBinComputer {
  uniformBindGroupLayout: GPUBindGroupLayout;
  storageBindGroupLayout: GPUBindGroupLayout;
  pipelineLayout: GPUPipelineLayout;

  mainPipeline: GPUComputePipeline;
  binSumPipeline: GPUComputePipeline;
  binPrefixSumPipeline: GPUComputePipeline;
  binReindexPipeline: GPUComputePipeline;

  shaderModule: GPUShaderModule;

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
  binInfoBuffers: GPUBuffer[];

  binReadBuffer: GPUBuffer;
  binInfoWriteBuffer: GPUBuffer;

  uniformBindGroup: GPUBindGroup;
  storageBindGroup: GPUBindGroup;

  constructor(globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice, objectCount: number) {
    this.shaderModule = device.createShaderModule({
      code: computeShaderHeader(objectCount) + shaderCode
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
        binding: 1, // binIn
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      }, {
        binding: 2, // binOut
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

    this.mainPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.shaderModule,
        entryPoint: 'main',
      },
    });

    this.binSumPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.shaderModule,
        entryPoint: 'binSum',
      },
    });

    this.binPrefixSumPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.shaderModule,
        entryPoint: 'binPrefixSum',
      },
    });

    this.binReindexPipeline = device.createComputePipeline({
      layout: computePipelineLayout,
      compute: {
        module: this.shaderModule,
        entryPoint: 'binReindex',
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
    // const binSquareSize = Math.max(verletObjectRadius * 2, 20);
    // const binGridWidth = Math.ceil((gridPixelDim / binSquareSize) / 2) * 2;
    // const binGridHeight = Math.ceil((gridPixelDim / binSquareSize) / 2) * 2;
    // const binGridSquareCount = Math.ceil((binGridWidth * binGridHeight) / 4) * 4;
    const binGridWidth = 128;
    const binGridHeight = 128;
    const binSquareSize = Math.ceil(gridPixelDim / 128);
    const binGridSquareCount = 16384; // 128*128
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
    const tmpOut: number[] = [];
    for (let i = 0; i < objectCount; i++) {
      const xpos = voDataArray[(i * voDataArrayStride)];
      const ypos = voDataArray[(i * voDataArrayStride) + 1];

      
      const binx = Math.floor((xpos + (bounds / 2)) / binSquareSize);
      const biny = Math.floor((ypos + (bounds / 2)) / binSquareSize);
      
      this.binData[i] = (biny * binGridWidth) + binx;
      tmpOut.push(xpos);
    }

    console.log(this.binData);
    console.log(`${bounds} ${binSquareSize} ${binGridWidth}`);

    this.binInfoBufferSize = this.binReindexBufferOffset + this.binReindexBufferSize;
    this.binInfoBuffers = new Array(2);
    this.binInfoBuffers[0] = device.createBuffer({
      size: this.binInfoBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.binInfoBuffers[0].getMappedRange(this.binBufferOffset, this.binBufferSize)).set(this.binData);
    this.binInfoBuffers[0].unmap();

    this.binInfoBuffers[1] = device.createBuffer({
      size: this.binInfoBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    new Float32Array(this.binInfoBuffers[1].getMappedRange(this.binBufferOffset, this.binBufferSize)).set(this.binData);
    this.binInfoBuffers[1].unmap();

    this.binReadBuffer = device.createBuffer({
      size: this.binBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    this.binInfoWriteBuffer = device.createBuffer({
      size: this.binInfoBufferSize,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE
    });

    this.uniformBindGroup = device.createBindGroup({
      layout: this.mainPipeline.getBindGroupLayout(1),
      entries: [{
          binding: 0,
          resource: { buffer: this.binParamsBuffer },
        }
      ]
    });

    this.storageBindGroup = device.createBindGroup({
      layout: this.mainPipeline.getBindGroupLayout(2),
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
            buffer: this.binInfoBuffers[0],
            offset: 0,
            size: this.binInfoBufferSize,
          },
        }, {
          binding: 2,
          resource: {
            buffer: this.binInfoBuffers[1],
            offset: 0,
            size: this.binInfoBufferSize,
          },
        },
      ],
    });
  }

  async compute(device: GPUDevice, globalUniformBindGroup: GPUBindGroup): Promise<GPUCommandBuffer[]> {
    // copy data from this.binInfoBuffers[1] to the read buffer
    let commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(this.binInfoBuffers[1], 0, this.binReadBuffer, 0, this.binBufferSize);

    // copy data from read buffer to cpu arrays
    await this.binReadBuffer.mapAsync(GPUMapMode.READ, 0, this.binBufferSize);
    this.binData = new Int32Array(this.binReadBuffer.getMappedRange(0, this.binBufferSize).slice(0));
    this.binReadBuffer.unmap();

    console.log(this.binData);

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

    // copy data back to this.binInfoBuffers[0]
    await this.binInfoWriteBuffer.mapAsync(GPUMapMode.WRITE, 0, this.binInfoBufferSize);
    
    new Int32Array(this.binInfoWriteBuffer.getMappedRange(this.binBufferOffset, this.binBufferSize)).set(this.binData);
    new Uint32Array(this.binInfoWriteBuffer.getMappedRange(this.binSumBufferOffset, this.binSumBufferSize)).set(this.binSumData);
    new Int32Array(this.binInfoWriteBuffer.getMappedRange(this.binPrefixSumBufferOffset, this.binPrefixSumBufferSize)).set(this.binPrefixSumData);
    new Int32Array(this.binInfoWriteBuffer.getMappedRange(this.binIndexTrackerBufferOffset, this.binIndexTrackerBufferSize)).set(this.binIndexTrackerData);
    new Uint32Array(this.binInfoWriteBuffer.getMappedRange(this.binReindexBufferOffset, this.binReindexBufferSize)).set(this.binReindexData);
    this.binInfoWriteBuffer.unmap();

    commandEncoder.copyBufferToBuffer(this.binInfoWriteBuffer, 0, this.binInfoBuffers[0], 0, this.binInfoBufferSize);
    
    const workgroupCount = Math.ceil(this.objectCount / 64);
    
    // let commandEncoder = device.createCommandEncoder();
    let passEncoder = commandEncoder.beginComputePass();
    passEncoder.setBindGroup(0, globalUniformBindGroup);
    passEncoder.setBindGroup(1, this.uniformBindGroup);
    passEncoder.setBindGroup(2, this.storageBindGroup);

    passEncoder.setPipeline(this.mainPipeline);
    passEncoder.dispatchWorkgroups(workgroupCount);

    passEncoder.end();
    
    return [commandEncoder.finish()];
  }
}