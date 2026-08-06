import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertCompiledHandlers,
  compiledPackageEntries,
  readHarnessPort,
  runRillServe,
} from '../src/index.js';
import type {
  RillCompiledPackage,
  RillServeContext,
  ServerHandle,
} from '../src/index.js';

// ============================================================
// TEMP DIR MANAGEMENT
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'honokit-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// TEST HELPERS
// ============================================================

function pkg(mount: string, outputPath: string): RillCompiledPackage {
  return { mount, buildOutput: { outputPath } };
}

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function makeServeContext(
  packages: RillCompiledPackage[],
  config: Record<string, unknown> = {}
): {
  ctx: RillServeContext;
  fireShutdown: () => Promise<void>;
} {
  const shutdownHandlers: Array<() => void | Promise<void>> = [];
  const ctx: RillServeContext = {
    config,
    logger: noopLogger,
    packages,
    requestedMount: undefined,
    args: [],
    onShutdown: (h) => {
      shutdownHandlers.push(h);
    },
    onSourceChange: () => undefined,
  };
  return {
    ctx,
    fireShutdown: async () => {
      for (const h of shutdownHandlers) await h();
    },
  };
}

// ============================================================
// readHarnessPort
// ============================================================

describe('readHarnessPort', () => {
  it('reads an integer port', () => {
    expect(readHarnessPort({ port: 8080 }, 3000)).toBe(8080);
  });

  it('reads an all-digit string port', () => {
    expect(readHarnessPort({ port: '8080' }, 3000)).toBe(8080);
  });

  it('falls back when absent', () => {
    expect(readHarnessPort({}, 3000)).toBe(3000);
  });

  it('falls back on a non-integer number', () => {
    expect(readHarnessPort({ port: 80.5 }, 3000)).toBe(3000);
  });

  it('falls back on a non-numeric string', () => {
    expect(readHarnessPort({ port: 'nope' }, 3000)).toBe(3000);
  });
});

// ============================================================
// compiledPackageEntries
// ============================================================

describe('compiledPackageEntries', () => {
  it('maps mount to name and outputPath to dir', () => {
    const entries = compiledPackageEntries({
      packages: [pkg('alpha', '/build/alpha'), pkg('beta', '/build/beta')],
    });
    expect(entries).toEqual([
      { name: 'alpha', dir: '/build/alpha' },
      { name: 'beta', dir: '/build/beta' },
    ]);
  });
});

// ============================================================
// assertCompiledHandlers
// ============================================================

describe('assertCompiledHandlers', () => {
  it('passes when every package emitted handler.js', async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, 'handler.js'), 'export default 0;', 'utf-8');

    expect(() =>
      assertCompiledHandlers({
        outputDir: dir,
        packages: [pkg('alpha', dir)],
        logger: noopLogger,
      })
    ).not.toThrow();
  });

  it('throws on a package missing handler.js', async () => {
    const dir = await makeTmpDir();

    expect(() =>
      assertCompiledHandlers({
        outputDir: dir,
        packages: [pkg('alpha', dir)],
        logger: noopLogger,
      })
    ).toThrow('missing handler file');
  });
});

// ============================================================
// runRillServe
// ============================================================

describe('runRillServe', () => {
  it('starts the server and registers close on shutdown', async () => {
    let closed = false;
    const handle: ServerHandle = {
      close: async () => {
        closed = true;
      },
    };
    let startedWith: ReadonlyArray<{ name: string; dir: string }> | undefined;

    const { ctx, fireShutdown } = makeServeContext([
      pkg('alpha', '/build/alpha'),
    ]);

    const servePromise = runRillServe(ctx, async (entries) => {
      startedWith = entries;
      return handle;
    });

    // Let the start callback resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(startedWith).toEqual([{ name: 'alpha', dir: '/build/alpha' }]);
    expect(closed).toBe(false);

    // serve() stays pending until the CLI's shutdown race resolves it.
    const raced = await Promise.race([
      servePromise.then(() => 'resolved'),
      Promise.resolve('pending'),
    ]);
    expect(raced).toBe('pending');

    // Firing shutdown closes the server handle.
    await fireShutdown();
    expect(closed).toBe(true);
  });
});
