import { defineConfig } from 'vitest/config';

import base from './vitest.config.mjs';

// `npm run bench`: the benchmark, which measures and asserts nothing, kept
// apart from the tests.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['bench/**/*.bench.ts'],
    // Print the table as it is, not under Vitest's per-test log headers.
    disableConsoleIntercept: true
  }
});
