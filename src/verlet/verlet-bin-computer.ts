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
  computePipelineLayout: GPUPipelineLayout;

  applyForcesPipeline: GPUComputePipeline;
  collidePipeline: GPUComputePipeline;
  collideIncrementPipeline: GPUComputePipeline;
  constrainPipeline: GPUComputePipeline;
  integratePipeline: GPUComputePipeline;

  binClearPipeline: GPUComputePipeline;
  binLinkClearPipeline: GPUComputePipeline;
  binSetPipeline: GPUComputePipeline;

  passDescriptor: GPUComputePassDescriptor;

  // buffer data
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

  storageBindGroupLayout: GPUBindGroupLayout;

  constructor(globalUniformBindGroupLayout: GPUBindGroupLayout, device: GPUDevice) {
    const uniformBindGroupLayout = device.createBindGroupLayout({
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
        uniformBindGroupLayout,  // @group(1)
        this.storageBindGroupLayout,  // @group(2)
      ]
    });
  }

  initBuffers(device: GPUDevice,
              bounds: number,
              objectCount: number,
              objectSize: number,
              voBuffer: GPUBuffer) {
    this.objectCount = objectCount;
    
    this.binSquareSize = objectSize * 2;
    this.binGridWidth = Math.ceil((bounds / this.binSquareSize) / 2) * 2;
    this.binGridHeight = Math.ceil((bounds / this.binSquareSize) / 2) * 2;
    this.binGridSquareCount = Math.ceil((this.binGridWidth * this.binGridHeight) / 4) * 4;

    this.binClearPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + binClearShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.binLinkClearPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + binLinkClearShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.binSetPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + binSetShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.applyForcesPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + applyForcesShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.collidePipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + collideShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.collideIncrementPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + collideIncrementShaderCode
        }),
        entryPoint: 'main',
      },
    });    

    this.constrainPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + constrainShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.integratePipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: computeShaderHeader() + integrateShaderCode
        }),
        entryPoint: 'main',
      },
    });
    
    // bin Parameters
    this.binParams = new Uint32Array([
      this.binSquareSize,      // bin square size
      this.binGridWidth,       // grid width
      this.binGridHeight,      // grid height
      this.binGridSquareCount, // number of grid squares
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
    new Uint32Array(this.binBuffer.getMappedRange()).set(this.binData);
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
      layout: this.storageBindGroupLayout,
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