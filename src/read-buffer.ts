/**
 * Copies the contents of a GPU buffer (which must have COPY_SRC usage) back to
 * the CPU: its first `size` bytes, a multiple of 4, or all of it.
 */
export async function readBuffer(
  device: GPUDevice,
  source: GPUBuffer,
  size = source.size
): Promise<ArrayBuffer> {
  if (size === 0) return new ArrayBuffer(0);
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ);
  const contents = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return contents;
}
