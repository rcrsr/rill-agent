import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  noExternal: ['@rcrsr/rill-agent-hono-kit'],
  dts: false,
  clean: true,
});
