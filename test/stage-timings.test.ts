import { describe, expect, it } from 'vitest';

import { formatTable, meanStageTimes } from '../bench/stage-timings';

describe('meanStageTimes', () => {
  it('averages each stage over the substeps it was timed in', () => {
    // Two substeps of two stages. Timestamps are nanoseconds, begin then end.
    const stages = ['binning', 'collide', 'binning', 'collide'];
    const timestamps = new BigInt64Array([
      1000n, 3000n, //   binning: 2 µs
      3000n, 9000n, //   collide: 6 µs
      20000n, 24000n, // binning: 4 µs
      24000n, 34000n // collide: 10 µs
    ]);

    expect(meanStageTimes(stages, timestamps)).toEqual([
      { stage: 'binning', ms: 0.003 },
      { stage: 'collide', ms: 0.008 }
    ]);
  });
});

describe('formatTable', () => {
  it('lists each stage, their sum and the wall-clock substep for each particle count', () => {
    const table = formatTable([
      {
        particles: 15000,
        stages: [
          { stage: 'binning', ms: 0.0123 },
          { stage: 'collide', ms: 0.05 }
        ],
        substepMs: 0.08
      },
      {
        particles: 1000000,
        stages: [
          { stage: 'binning', ms: 1.5 },
          { stage: 'collide', ms: 12.25 }
        ],
        substepMs: 14.5
      }
    ]);

    expect(table).toBe(
      [
        'ms per substep       15,000  1,000,000',
        'binning               0.012      1.500',
        'collide               0.050     12.250',
        'all stages            0.062     13.750',
        'substep, wall clock   0.080     14.500'
      ].join('\n')
    );
  });

  it('shows only the wall-clock substep when stages were not timed', () => {
    const table = formatTable([{ particles: 15000, stages: null, substepMs: 0.08 }]);

    expect(table).toBe(
      ['ms per substep       15,000', 'substep, wall clock   0.080'].join('\n')
    );
  });
});
