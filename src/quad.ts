export class Quad {
  vertexSize = 4 * 6;
  vertexCount = 6;
  positionOffset = 0;
  uvOffset = 4 * 4;

  vertexArray = new Float32Array([
      // float4 position, float2 uv,
    -1,  1, 0,  1,   0, 0,
    -1, -1, 0,  1,   0, 1,
     1,  1, 0,  1,   1, 0,
     1, -1, 0,  1,   1, 1,
  ]);

  indexArray = new Uint16Array([0, 1, 2, 2, 1, 3]);

  verticesBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;

  constructor(device: GPUDevice) {
    this.verticesBuffer = device.createBuffer({
      size: this.vertexArray.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.verticesBuffer.getMappedRange()).set(this.vertexArray);
    this.verticesBuffer.unmap();

    this.indexBuffer = device.createBuffer({
      size: this.indexArray.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    new Uint16Array(this.indexBuffer.getMappedRange()).set(this.indexArray);
    this.indexBuffer.unmap();
  }

  bufferDescription(): GPUVertexBufferLayout[] {
    const positionAttribDesc: GPUVertexAttribute = {
      shaderLocation: 0, // [[location(0)]]
      offset: 0,
      format: 'float32x3'
    };
    const colorAttribDesc: GPUVertexAttribute = {
      shaderLocation: 1, // [[location(1)]]
      offset: 0,
      format: 'float32x3'
    };
    const positionBufferDesc: GPUVertexBufferLayout = {
      attributes: [positionAttribDesc],
      arrayStride: 4 * 3, // sizeof(float) * 3
      stepMode: 'vertex'
    };
    const colorBufferDesc: GPUVertexBufferLayout = {
      attributes: [colorAttribDesc],
      arrayStride: 4 * 3, // sizeof(float) * 3
      stepMode: 'vertex'
    };

    return [{
      // vertex buffer
      arrayStride: this.vertexSize,
      stepMode: 'vertex',
      attributes: [{
          // position
          shaderLocation: 0,
          offset: this.positionOffset,
          format: 'float32x4',
        }, {
          // uv
          shaderLocation: 1,
          offset: this.uvOffset,
          format: 'float32x2',
        },],
      }, {
        // instanced particles buffer
        arrayStride: 16 * 4,
        stepMode: 'instance',
        attributes: [{
            // instance position
            shaderLocation: 2,
            offset: 0,
            format: 'float32x4',
          }, {
            // instance previous position
            shaderLocation: 3,
            offset: 4 * 4,
            format: 'float32x4',
          }, {
            // instance acceleration
            shaderLocation: 4,
            offset: 8 * 4,
            format: 'float32x4',
          }, {
            // instance rgb-Radius
            shaderLocation: 5,
            offset: 12 * 4,
            format: 'float32x4',
          },
        ],
      }
    ];
  }
}