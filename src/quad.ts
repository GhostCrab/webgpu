import shaderCode from './shaders/instancedCircle.wgsl';

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

  getBufferDescription(): GPUVertexBufferLayout {
    return {
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
        },
      ],
    }
  }

  render(passEncoder: GPURenderPassEncoder, count: number) {
    passEncoder.setVertexBuffer(0, this.verticesBuffer);
    passEncoder.setIndexBuffer(this.indexBuffer, 'uint16');
    passEncoder.drawIndexed(6, count);
  }
}