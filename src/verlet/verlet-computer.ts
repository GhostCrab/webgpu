import shaderCode from './verlet-computer.wgsl';

export class VerletComputer {
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

  binBufferSize: number;
  binBufferOffset: number;
  binSumBufferSize: number;
  binSumBufferOffset: number;
  binPrefixSumBufferSize: number;
  binPrefixSumBufferOffset: number;
  binIndexTrackerBufferSize: number;
  binIndexTrackerBufferOffset: number;
  binReindexBufferSize: number;
  binReindexBufferOffset: number;
  
  binInfoBufferSize: number;
  binInfoBuffers: GPUBuffer[];

  binReadBuffer: GPUBuffer;
  
  uniformBindGroup: GPUBindGroup;
  storageBindGroups: GPUBindGroup[];

  constructor(globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice) {
    this.shaderModule = device.createShaderModule({
      code: shaderCode
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
        binding:  0, // verletObjectsIn
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      }, {
        binding:  1, // verletObjectsOut
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      }, {
        binding:  2, // binIn
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      }, {
        binding:  3, // binOut
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      }]
    });

    const computePipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        globalUniformBindGroupLayout,       // @group(0)
        this.uniformBindGroupLayout, // @group(1)
        this.storageBindGroupLayout, // @group(2)
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

  initBuffers(device: GPUDevice, bounds: number, objectCount: number, voBuffers: GPUBuffer[]) {
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

    this.binBufferSize = Int32Array.BYTES_PER_ELEMENT * objectCount;
    this.binBufferOffset = 0;
    
    this.binSumBufferSize = Uint32Array.BYTES_PER_ELEMENT * binGridSquareCount;
    this.binSumBufferOffset = this.binBufferOffset + this.binBufferSize;
    
    this.binPrefixSumBufferSize = Int32Array.BYTES_PER_ELEMENT * binGridSquareCount;
    this.binPrefixSumBufferOffset = this.binSumBufferOffset + this.binSumBufferSize;
    
    this.binIndexTrackerBufferSize = Int32Array.BYTES_PER_ELEMENT * binGridSquareCount;
    this.binIndexTrackerBufferOffset = this.binPrefixSumBufferOffset + this.binPrefixSumBufferSize;
    
    this.binReindexBufferSize = Uint32Array.BYTES_PER_ELEMENT * objectCount;
    this.binReindexBufferOffset = this.binIndexTrackerBufferOffset + this.binIndexTrackerBufferSize;
    
    this.binInfoBufferSize = this.binReindexBufferOffset + this.binReindexBufferSize;
    this.binInfoBuffers = new Array(2);
    for (let i = 0; i < 2; ++i) {
      this.binInfoBuffers[i] = device.createBuffer({
        size: this.binInfoBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
    }

    this.binReadBuffer = device.createBuffer({
      size: this.binBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    })

    this.uniformBindGroup = device.createBindGroup({
      layout: this.mainPipeline.getBindGroupLayout(1),
      entries: [{
          binding: 0,
          resource: { buffer: this.binParamsBuffer },
        }
      ]
    });

    this.storageBindGroups = new Array(2);
    for (let i = 0; i < 2; ++i) {
      this.storageBindGroups[i] = device.createBindGroup({
        layout: this.mainPipeline.getBindGroupLayout(2),
        entries: [{
            binding: 0,
            resource: {
              buffer: voBuffers[i],
              offset: 0,
              size: voBuffers[i].size,
            },
          }, {
            binding: 1,
            resource: {
              buffer: voBuffers[(i + 1) % 2],
              offset: 0,
              size: voBuffers[(i + 1) % 2].size,
            },
          }, {
            binding: 2,
            resource: {
              buffer: this.binInfoBuffers[i],
              offset: 0,
              size: this.binInfoBufferSize,
            },
          }, {
            binding: 3,
            resource: {
              buffer: this.binInfoBuffers[(i + 1) % 2],
              offset: 0,
              size: this.binInfoBufferSize,
            },
          },
        ],
      });
    }
  }

  compute(passEncoder: GPUComputePassEncoder, frame: number) {
    const workgroupCount = Math.ceil(this.objectCount / 64);

    passEncoder.setBindGroup(1, this.uniformBindGroup);
    passEncoder.setBindGroup(2, this.storageBindGroups[frame % 2]);
        
    passEncoder.setPipeline(this.mainPipeline);
    passEncoder.dispatchWorkgroups(workgroupCount);
  }
}