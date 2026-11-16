/** What one frame of the clock asks the simulation to do. */
export interface ClockTick {
  /** Substeps to run this frame. */
  substeps: number;
  /** Substeps the elapsed time called for, before the per-frame limit. */
  wanted: number;
}

/**
 * The substep rate the app starts with: 40 substeps per 60 Hz frame. The new
 * pipeline's collision solve needs twice the 1200 per second the current
 * pipeline used to leave a pile as little overlap (#14).
 */
export const DEFAULT_SUBSTEP_RATE = 2400;

/** The most simulated time one frame may cover, in seconds. */
export const MAX_FRAME_TIME = 1 / 60;

// Frame intervals are not exact in binary, so 60 intervals of 1/60 s can sum
// to a hair under one second. Time within this fraction of a substep counts
// as a whole one, so the shortfall does not drop a substep.
const ROUNDING = 1e-6;

/** Rejects a substep rate that is not a positive, finite number of substeps per second. */
export function checkSubstepRate(substepRate: number) {
  if (!(substepRate > 0) || !Number.isFinite(substepRate)) {
    throw new Error(`substep rate must be a positive number; got ${substepRate}`);
  }
}

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
    checkSubstepRate(substepRate);
    if (!(elapsed > 0) || !Number.isFinite(elapsed)) elapsed = 0;

    const whole = (time: number) => Math.floor(time * substepRate + ROUNDING);
    const wanted = whole(this.carried + elapsed);
    const owed = this.carried + Math.min(elapsed, MAX_FRAME_TIME);
    const substeps = whole(owed);
    this.carried = Math.max(0, owed - substeps / substepRate);
    return { substeps, wanted };
  }
}

/**
 * Frames per second for a frame `elapsed` seconds after the last, or null
 * when that is unknown: two frames that share a timestamp, or time that does
 * not move forward.
 */
export function frameRate(elapsed: number): number | null {
  return elapsed > 0 && Number.isFinite(elapsed) ? 1 / elapsed : null;
}
