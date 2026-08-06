import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import harness from '../src/index.js';

// The default export is the rill-CLI harness adapter (role: "harness").
// serve() binds a socket, which this repo's tests deliberately avoid; the
// shared serve glue is covered socket-free in @rcrsr/rill-agent-hono-kit's
// runRillServe test. Here we verify the adapter shape and its postBuild gate.

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'http-adapter-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('http RillHarness default export', () => {
  it('declares the package name and serve/postBuild hooks', () => {
    expect(harness.name).toBe('@rcrsr/rill-agent-http');
    expect(typeof harness.serve).toBe('function');
    expect(typeof harness.postBuild).toBe('function');
  });

  it('postBuild passes when every package emitted handler.js', async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, 'handler.js'), 'export default 0;', 'utf-8');

    await expect(
      harness.postBuild?.({
        outputDir: dir,
        packages: [{ mount: 'alpha', buildOutput: { outputPath: dir } }],
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      })
    ).resolves.toBeUndefined();
  });

  it('postBuild throws on a package missing handler.js', async () => {
    const dir = await makeTmpDir();

    await expect(
      harness.postBuild?.({
        outputDir: dir,
        packages: [{ mount: 'alpha', buildOutput: { outputPath: dir } }],
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      })
    ).rejects.toThrow('missing handler file');
  });
});
