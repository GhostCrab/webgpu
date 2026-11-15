import { create, globals } from 'webgpu';

// Dawn's WebGPU implementation for Node. The simulation code under test is the
// same code the browser runs, so it needs the same globals the browser has.
Object.assign(globalThis, globals);
const gpu: GPU = create([]);
Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true });

let devicePromise: Promise<GPUDevice | null> | undefined;

/** Resolves to null when this machine has no usable GPU; GPU tests then skip. */
export function getDevice(): Promise<GPUDevice | null> {
  devicePromise ??= (async () => {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (e) => {
      // A validation error must fail the run, not scroll past in a log.
      throw new Error(`WebGPU error: ${(e as GPUUncapturedErrorEvent).error.message}`);
    });
    return device;
  })();
  return devicePromise;
}
