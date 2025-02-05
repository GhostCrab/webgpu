import { computeShaderHeader } from './shaders/verlet-computer-shader-header';

import applyForcesShaderCode from './shaders/apply-forces.wgsl';
import collideShaderCode from './shaders/collide.wgsl';
import collideIncrementShaderCode from './shaders/collideIncrement.wgsl';
import constrainShaderCode from './shaders/constrain.wgsl';
import integrateShaderCode from './shaders/integrate.wgsl';

import binClearShaderCode from './shaders/bin-clear.wgsl';
import binLinkClearShaderCode from './shaders/bin-link-clear.wgsl';
import binSetShaderCode from './shaders/bin-set.wgsl';

export class VerletBinComputer {

  uniformBindGroupLayout: GPUBindGroupLayout;
  storageBindGroupLayout: GPUBindGroupLayout;
  computePipelineLayout: GPUPipelineLayout;

  applyForcesPipeline: GPUComputePipeline;
  collidePipeline: GPUComputePipeline;
  collideIncrementPipeline: GPUComputePipeline;
  constrainPipeline: GPUComputePipeline;
  integratePipeline: GPUComputePipeline;

  binClearPipeline: GPUComputePipeline;
  binLinkClearPipeline: GPUComputePipeline;
  binSetPipeline: GPUComputePipeline;

  applyForcesShaderModule: GPUShaderModule;
  collideShaderModule: GPUShaderModule;
  collideIncrementShaderModule: GPUShaderModule;
  constrainShaderModule: GPUShaderModule;
  integrateShaderModule: GPUShaderModule;

  binClearShaderModule: GPUShaderModule;
  binLinkClearShaderModule: GPUShaderModule;
  binSetShaderModule: GPUShaderModule;

  passDescriptor: GPUComputePassDescriptor;

  // buffer data
  gridPixelDim: number;
  binSquareSize: number;
  binGridWidth: number;
  binGridHeight: number;
  binGridSquareCount: number;

  objectCount: number;

  binParams: Uint32Array;

  binParamsBufferSize: number;
  binParamsBuffer: GPUBuffer;

  cso: Uint32Array;

  csoBufferSize: number;
  csoBuffer: GPUBuffer;

  binData: Int32Array
  binBuffer: GPUBuffer;

  uniformBindGroup: GPUBindGroup;
  storageBindGroup: GPUBindGroup;

  constructor(globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice) {
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
        binding: 1, // bins
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      }, {
        binding: 2, // cso
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      }]
    });

    this.computePipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        globalUniformBindGroupLayout, // @group(0)
        this.uniformBindGroupLayout,  // @group(1)
        this.storageBindGroupLayout,  // @group(2)
      ]
    });

    this.passDescriptor = {};
  }

  initBuffers(device: GPUDevice,
              bounds: number,
              objectCount: number,
              objectSize: number,
              voBuffer: GPUBuffer) {
    this.objectCount = objectCount;
    this.gridPixelDim = bounds;

    this.binSquareSize = objectSize * 2;
    this.binGridWidth = Math.ceil((this.gridPixelDim / this.binSquareSize) / 2) * 2;
    this.binGridHeight = Math.ceil((this.gridPixelDim / this.binSquareSize) / 2) * 2;
    this.binGridSquareCount = Math.ceil((this.binGridWidth * this.binGridHeight) / 4) * 4;

    this.binClearShaderModule = device.createShaderModule({
      code: computeShaderHeader() + binClearShaderCode
    });

    this.binLinkClearShaderModule = device.createShaderModule({
      code: computeShaderHeader() + binLinkClearShaderCode
    });

    this.binSetShaderModule = device.createShaderModule({
      code: computeShaderHeader() + binSetShaderCode
    });

    this.applyForcesShaderModule = device.createShaderModule({
      code: computeShaderHeader() + applyForcesShaderCode
    });

    this.collideShaderModule = device.createShaderModule({
      code: computeShaderHeader() + collideShaderCode
    });

    this.collideIncrementShaderModule = device.createShaderModule({
      code: computeShaderHeader() + collideIncrementShaderCode
    });

    this.constrainShaderModule = device.createShaderModule({
      code: computeShaderHeader() + constrainShaderCode
    });

    this.integrateShaderModule = device.createShaderModule({
      code: computeShaderHeader() + integrateShaderCode
    });

    this.binClearPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.binClearShaderModule,
        entryPoint: 'main',
      },
    });

    this.binLinkClearPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.binLinkClearShaderModule,
        entryPoint: 'main',
      },
    });

    this.binSetPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.binSetShaderModule,
        entryPoint: 'main',
      },
    });

    this.applyForcesPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.applyForcesShaderModule,
        entryPoint: 'main',
      },
    });

    this.collidePipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.collideShaderModule,
        entryPoint: 'main',
      },
    });

    this.collideIncrementPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.collideIncrementShaderModule,
        entryPoint: 'main',
      },
    });    

    this.constrainPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.constrainShaderModule,
        entryPoint: 'main',
      },
    });

    this.integratePipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: this.integrateShaderModule,
        entryPoint: 'main',
      },
    });
    
    this.binParams = new Uint32Array([
      this.binSquareSize,      // bin square size
      this.binGridWidth,       // grid width
      this.binGridHeight,      // grid height
      this.binGridSquareCount, // number of grid squares
      0,                       // bin X start offset
      0,                       // bin Y start offset
      0,
      0
    ]);

    this.binParamsBuffer = device.createBuffer({
      size: this.binParams.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.binParamsBuffer.getMappedRange()).set(this.binParams);
    this.binParamsBuffer.unmap();

    // CSO Buffer
    this.cso = new Uint32Array([
      0,                       // bin X start offset
      0,                       // bin Y start offset
    ]);

    this.csoBuffer = device.createBuffer({
      size: this.cso.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.csoBuffer.getMappedRange()).set(this.cso);
    this.csoBuffer.unmap();

    // binData: Int32Array
    this.binData = new Int32Array(this.binGridSquareCount);
    this.binBuffer = device.createBuffer({
      size: this.binData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(this.binBuffer.getMappedRange()).set(this.binData);
    this.binBuffer.unmap();

    this.uniformBindGroup = device.createBindGroup({
      layout: this.binSetPipeline.getBindGroupLayout(1),
      entries: [{
          binding: 0,
          resource: { buffer: this.binParamsBuffer },
        }
      ]
    });

    this.storageBindGroup = device.createBindGroup({
      layout: this.binSetPipeline.getBindGroupLayout(2),
      entries: [{
          binding: 0,
          resource: { buffer: voBuffer },
        }, {
          binding: 1,
          resource: { buffer: this.binBuffer },
        }, {
          binding: 2,
          resource: { buffer: this.csoBuffer },
        }
      ],
    });
  }

  compute(device: GPUDevice, commandEncoder: GPUCommandEncoder, globalUniformBindGroup: GPUBindGroup, doCollision: boolean) {
    const voWorkgroupCount = Math.ceil(this.objectCount / 64);
    const binWorkgroupCount = Math.ceil(this.binGridSquareCount / 64);
    const binSubXWorkgroupCount = Math.ceil((this.binGridWidth / 2) / 16);
    const binSubYWorkgroupCount = Math.ceil((this.binGridHeight / 2) / 16);

    let passEncoder = commandEncoder.beginComputePass();
    passEncoder.setBindGroup(0, globalUniformBindGroup);
    passEncoder.setBindGroup(1, this.uniformBindGroup);
    passEncoder.setBindGroup(2, this.storageBindGroup);

    // binning
    if (doCollision) {
      passEncoder.setPipeline(this.binClearPipeline);
      passEncoder.dispatchWorkgroups(binWorkgroupCount);

      passEncoder.setPipeline(this.binLinkClearPipeline);
      passEncoder.dispatchWorkgroups(voWorkgroupCount);

      passEncoder.setPipeline(this.binSetPipeline);
      passEncoder.dispatchWorkgroups(voWorkgroupCount);
    }

    // verlet integration
    passEncoder.setPipeline(this.applyForcesPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    if (doCollision) {
      passEncoder.setPipeline(this.collidePipeline);
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);

      passEncoder.setPipeline(this.collideIncrementPipeline);
      passEncoder.dispatchWorkgroups(1);

      passEncoder.setPipeline(this.collidePipeline);
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);

      passEncoder.setPipeline(this.collideIncrementPipeline);
      passEncoder.dispatchWorkgroups(1);

      passEncoder.setPipeline(this.collidePipeline);
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);

      passEncoder.setPipeline(this.collideIncrementPipeline);
      passEncoder.dispatchWorkgroups(1);

      passEncoder.setPipeline(this.collidePipeline);
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);
      
      passEncoder.setPipeline(this.collideIncrementPipeline);
      passEncoder.dispatchWorkgroups(1);
    }

    passEncoder.setPipeline(this.constrainPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.setPipeline(this.integratePipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.end();   
  }
}