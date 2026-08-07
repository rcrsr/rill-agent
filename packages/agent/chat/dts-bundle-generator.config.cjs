/** @type {import('dts-bundle-generator/config-schema').BundlerConfig} */
const config = {
  compilationOptions: {
    preferredConfigPath: './tsconfig.dts.json',
  },
  entries: [
    {
      filePath: './src/index.ts',
      outFile: './dist/index.d.ts',
      libraries: {
        inlinedLibraries: ['@rcrsr/rill-agent-hono-kit'],
      },
    },
  ],
};

module.exports = config;
