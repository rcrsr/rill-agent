import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill-agent': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    globals: false,
  },
});
