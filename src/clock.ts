/** What one frame of the clock asks the simulation to do. */
export interface ClockTick {
  /** Substeps to run this frame. */
  substeps: number;
  /** Substeps the elapsed time called for, before the per-frame limit. */
  wanted: number;
}

/** The substep rate the app starts with: 20 substeps per 60 Hz frame. */
export const DEFAULT_SUBSTEP_RATE = 1200;

/** The most simulated time one frame may cover, in seconds. */
export const MAX_FRAME_TIME = 1 / 60;

// Frame intervals are not exact in binary, so 60 intervals of 1/60 s can sum
// to a hair under one second. Time within this fraction of a substep counts
// as a whole one, so the shortfall does not drop a substep.
const ROUNDING = 1e-6;

/**
 * The clock: turns the time elapsed between frames into a whole number of
 * substeps, each covering 1 / substepRate seconds of simulated time. Time too
 * short for a whole substep is carried into the next frame.
 */
export class Clock {
  /** Elapsed time not yet covered by a substep, in seconds. */
  private carried = 0;

  /**
   * The substeps for a frame `elapsed` seconds after the last one. A frame
   * covers at most MAX_FRAME_TIME of simulated time; time beyond that is
   * dropped, so after a stall the simulation runs slower than real time
   * rather than lurching forward.
   */
  advance(elapsed: number, substepRate: number): ClockTick {
    if (!(substepRate > 0) || !Number.isFinite(substepRate)) {
      throw new Error(`substep rate must be a positive number; got ${substepRate}`);
    }
    if (!(elapsed > 0) || !Number.isFinite(elapsed)) elapsed = 0;

    const whole = (time: number) => Math.floor(time * substepRate + ROUNDING);
    const wanted = whole(this.carried + elapsed);
    const owed = this.carried + Math.min(elapsed, MAX_FRAME_TIME);
    const substeps = whole(owed);
    this.carried = Math.max(0, owed - substeps / substepRate);
    return { substeps, wanted };
  }
}
