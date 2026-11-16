/** The mean GPU time of one stage of a substep. */
export interface StageTime {
  stage: string;
  ms: number;
}

/**
 * Averages timed passes by stage. `stages[i]` names the pass whose begin and
 * end timestamps, in nanoseconds, are `timestamps[2i]` and `timestamps[2i + 1]`.
 * Stages are returned in the order they were first timed.
 */
export function meanStageTimes(stages: string[], timestamps: BigInt64Array): StageTime[] {
  const totals = new Map<string, { ns: number; passes: number }>();
  stages.forEach((stage, i) => {
    const ns = Number(timestamps[2 * i + 1] - timestamps[2 * i]);
    const total = totals.get(stage) ?? { ns: 0, passes: 0 };
    total.ns += ns;
    total.passes++;
    totals.set(stage, total);
  });
  return [...totals].map(([stage, { ns, passes }]) => ({ stage, ms: ns / passes / 1e6 }));
}

/** What the benchmark measured at one particle count. */
export interface BenchResult {
  particles: number;
  /** Mean GPU time per stage, or null when timestamp queries are unavailable. */
  stages: StageTime[] | null;
  /** Mean wall-clock time per substep, from submission to completion. */
  substepMs: number;
}

/**
 * Lays the results out as a plain-text table: one column per particle count,
 * one row per stage, then the sum of the stages and the wall-clock substep.
 */
export function formatTable(results: BenchResult[]): string {
  const ms = (value: number) => value.toFixed(3);
  const rows: string[][] = [['ms per substep', ...results.map((r) => r.particles.toLocaleString('en-US'))]];

  const timed = results.find((r) => r.stages)?.stages ?? [];
  for (const { stage } of timed) {
    rows.push([stage, ...results.map((r) => cell(r.stages?.find((s) => s.stage === stage)?.ms))]);
  }
  if (timed.length > 0) {
    rows.push(['all stages', ...results.map((r) => cell(r.stages?.reduce((sum, s) => sum + s.ms, 0)))]);
  }
  rows.push(['substep, wall clock', ...results.map((r) => ms(r.substepMs))]);

  function cell(value: number | undefined) {
    return value === undefined ? '-' : ms(value);
  }

  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((text, column) =>
          column === 0 ? text.padEnd(widths[0]) : text.padStart(widths[column] + 2)
        )
        .join('')
    )
    .join('\n');
}
