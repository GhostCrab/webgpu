import { readBuffer } from '../src/read-buffer';
import type { StageTimer } from '../src/verlet/verlet';
import { meanStageTimes, StageTime } from './stage-timings';

/**
 * Records a begin and end timestamp for each timed pass, up to `passes`
 * passes, and averages them by stage. Needs a device with 'timestamp-query'.
 */
export class GpuStageTimer implements StageTimer {
  private stages: string[] = [];
  private querySet: GPUQuerySet;
  private resolveBuffer: GPUBuffer;

  constructor(
    private device: GPUDevice,
    private passes: number
  ) {
    this.querySet = device.createQuerySet({ type: 'timestamp', count: passes * 2 });
    this.resolveBuffer = device.createBuffer({
      size: passes * 2 * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
    });
  }

  timestampWrites(stage: string): GPUComputePassTimestampWrites {
    const pass = this.stages.length;
    if (pass >= this.passes) {
      throw new Error(`the timer holds ${this.passes} passes; time fewer substeps per read`);
    }
    this.stages.push(stage);
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: 2 * pass,
      endOfPassWriteIndex: 2 * pass + 1
    };
  }

  /** Mean GPU time per stage of the passes timed so far. Call after submitting them. */
  async read(): Promise<StageTime[]> {
    const encoder = this.device.createCommandEncoder();
    encoder.resolveQuerySet(this.querySet, 0, this.stages.length * 2, this.resolveBuffer, 0);
    this.device.queue.submit([encoder.finish()]);
    const timestamps = new BigInt64Array(await readBuffer(this.device, this.resolveBuffer));
    return meanStageTimes(this.stages, timestamps);
  }

  destroy() {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
  }
}
