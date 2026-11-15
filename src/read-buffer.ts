/** Copies the contents of a GPU buffer (which must have COPY_SRC usage) back to the CPU. */
export async function readBuffer(device: GPUDevice, source: GPUBuffer): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    size: source.size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, source.size);
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ);
  const contents = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return contents;
}
