import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill-agent': path.resolve(__dirname, '../core/src/index.ts'),
      '@rcrsr/rill-agent-hono-kit': path.resolve(
        __dirname,
        '../../shared/hono-kit/src/index.ts'
      ),
    },
  },
  test: {
    globals: false,
  },
});
