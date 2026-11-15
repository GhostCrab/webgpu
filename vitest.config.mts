import { readFileSync } from 'fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // Mirror webpack's `asset/source` rule: a .wgsl import is the file's text.
      name: 'wgsl-source',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('.wgsl')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
        }
      }
    }
  ],
  test: {
    include: ['test/**/*.test.ts'],
    // Dawn is a native addon; run it in a child process, one file at a time.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60000
  }
});
