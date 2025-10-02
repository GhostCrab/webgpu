// Common WGSL header with shared structures and bindings
import commonWGSL from './shaders/common.wgsl';

// Compute shader modules
import applyForcesShaderCode from './shaders/apply-forces.wgsl';
import collideShaderCode from './shaders/collide.wgsl';
import constrainShaderCode from './shaders/constrain.wgsl';
import integrateShaderCode from './shaders/integrate.wgsl';

// Bin management shader modules
import binClearShaderCode from './shaders/bin-clear.wgsl';
import binLinkClearShaderCode from './shaders/bin-link-clear.wgsl';
import binSetShaderCode from './shaders/bin-set.wgsl';

// Generate collision shader variants with hardcoded CSO offsets
// This eliminates the need for the collideIncrement shader and pipeline switches
function generateCollideShaderVariant(xOffset: number, yOffset: number): string {
  return collideShaderCode
    .replace('var binX = (binStepX * 2) + cso.xOffset;', `var binX = (binStepX * 2) + ${xOffset};`)
    .replace('var binY = (binStepY * 2) + cso.yOffset;', `var binY = (binStepY * 2) + ${yOffset};`)
    // Remove the CSO binding since we don't need it anymore
    .replace('@group(2) @binding(2) var<storage, read_write> cso: CollisionStepOffset;\n', '');
}

export class VerletBinComputer {
  computePipelineLayout: GPUPipelineLayout;

  applyForcesPipeline: GPUComputePipeline;
  collidePipeline0: GPUComputePipeline;  // CSO offset (0,0)
  collidePipeline1: GPUComputePipeline;  // CSO offset (1,0)
  collidePipeline2: GPUComputePipeline;  // CSO offset (0,1)
  collidePipeline3: GPUComputePipeline;  // CSO offset (1,1)
  constrainPipeline: GPUComputePipeline;
  integratePipeline: GPUComputePipeline;

  binClearPipeline: GPUComputePipeline;
  binLinkClearPipeline: GPUComputePipeline;
  binSetPipeline: GPUComputePipeline;

  passDescriptor: GPUComputePassDescriptor;

  // Track if this is the first frame for initialization
  isFirstFrame: boolean = true;

  // buffer data
  binSquareSize: number;
  binGridWidth: number;
  binGridHeight: number;
  binGridSquareCount: number;

  objectCount: number;

  binParams: Uint32Array;

  binParamsBufferSize: number;
  binParamsBuffer: GPUBuffer;

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
      }]
      // Note: CSO buffer removed - offsets are now hardcoded in shader variants
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
          code: commonWGSL + binClearShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.binLinkClearPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + binLinkClearShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.binSetPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + binSetShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.applyForcesPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + applyForcesShaderCode
        }),
        entryPoint: 'main',
      },
    });

    // Create 4 collision pipeline variants with hardcoded CSO offsets
    // Pattern: (0,0) -> (1,0) -> (0,1) -> (1,1)
    this.collidePipeline0 = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + generateCollideShaderVariant(0, 0)
        }),
        entryPoint: 'main',
      },
    });

    this.collidePipeline1 = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + generateCollideShaderVariant(1, 0)
        }),
        entryPoint: 'main',
      },
    });

    this.collidePipeline2 = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + generateCollideShaderVariant(0, 1)
        }),
        entryPoint: 'main',
      },
    });

    this.collidePipeline3 = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + generateCollideShaderVariant(1, 1)
        }),
        entryPoint: 'main',
      },
    });

    this.constrainPipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + constrainShaderCode
        }),
        entryPoint: 'main',
      },
    });

    this.integratePipeline = device.createComputePipeline({
      layout: this.computePipelineLayout,
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + integrateShaderCode
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
        }
        // Note: CSO buffer removed - offsets are now hardcoded in shader variants
      ],
    });
  }

  reset() {
    // Reset to first frame state when buffers are reinitialized
    this.isFirstFrame = true;
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

      // Only clear bin links on the first frame - afterwards integrate.wgsl does this
      if (this.isFirstFrame) {
        passEncoder.setPipeline(this.binLinkClearPipeline);
        passEncoder.dispatchWorkgroups(voWorkgroupCount);
      }

      passEncoder.setPipeline(this.binSetPipeline);
      passEncoder.dispatchWorkgroups(voWorkgroupCount);
    }

    // verlet integration
    passEncoder.setPipeline(this.applyForcesPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    if (doCollision) {
      // Checkerboard collision detection: 4 passes with hardcoded offsets
      // Each pipeline variant has its CSO offset baked in at compile time
      passEncoder.setPipeline(this.collidePipeline0);  // offset (0,0)
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);

      passEncoder.setPipeline(this.collidePipeline1);  // offset (1,0)
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);

      passEncoder.setPipeline(this.collidePipeline2);  // offset (0,1)
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);

      passEncoder.setPipeline(this.collidePipeline3);  // offset (1,1)
      passEncoder.dispatchWorkgroups(binSubXWorkgroupCount, binSubYWorkgroupCount);
    }

    passEncoder.setPipeline(this.constrainPipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.setPipeline(this.integratePipeline);
    passEncoder.dispatchWorkgroups(voWorkgroupCount);

    passEncoder.end();

    // Mark that we've completed the first frame
    this.isFirstFrame = false;
  }
}