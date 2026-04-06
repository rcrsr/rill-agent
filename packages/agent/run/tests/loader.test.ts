import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '@rcrsr/rill-agent-bundle';
import { ComposeError } from '@rcrsr/rill-agent-shared';
import { loadBundle } from '../src/loader.js';

// Bundle output must be under the run package root so that handlers.js
// can resolve @rcrsr/rill-agent-harness via the package's node_modules.
const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);
const BUNDLES_BASE = path.join(PKG_ROOT, '.test-bundles');

// ============================================================
// MINIMAL RILL-CONFIG TEMPLATE
// ============================================================

function makeRillConfig(name: string): Record<string, unknown> {
  return {
    name,
    version: '0.1.0',
    main: 'main.rill:run',
  };
}

// ============================================================
// TEMP DIR MANAGEMENT
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(base: string = PKG_ROOT): Promise<string> {
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'loader-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// BUNDLE FIXTURE HELPER (for AC-59 success case)
// ============================================================

async function makeBundle(
  script: string,
  agentName = 'test-agent'
): Promise<string> {
  const fixtureDir = await makeTmpDir(PKG_ROOT);
  const bundleDir = await makeTmpDir(BUNDLES_BASE);

  await writeFile(
    path.join(fixtureDir, 'rill-config.json'),
    JSON.stringify(makeRillConfig(agentName), null, 2),
    'utf-8'
  );
  await writeFile(path.join(fixtureDir, 'main.rill'), script, 'utf-8');

  await buildBundle(fixtureDir, {
    outputDir: bundleDir,
  });

  return bundleDir;
}

// ============================================================
// MINIMAL BUNDLE.JSON FOR MANUAL FIXTURES
// ============================================================

function makeMinimalBundleJson(agentName: string): string {
  return JSON.stringify({
    name: 'test',
    version: '0.1.0',
    built: '',
    checksum: '',
    rillVersion: '',
    configVersion: '2',
    agents: {
      [agentName]: {
        configPath: `agents/${agentName}/rill-config.json`,
      },
    },
  });
}

// ============================================================
// ERROR CASES
// ============================================================

describe('loadBundle error cases', () => {
  // EC-19: bundle dir missing → Error with path
  it('EC-19: missing bundle dir throws Error containing the path', async () => {
    const missingDir = path.join(
      PKG_ROOT,
      '.test-bundles',
      'does-not-exist-ec19'
    );

    await expect(loadBundle(missingDir)).rejects.toThrow(missingDir);
  });

  // EC-20: invalid JSON in bundle.json → Error with parse error detail
  it('EC-20: invalid bundle.json JSON throws Error with parse error detail', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      'not-valid-json',
      'utf-8'
    );

    await expect(loadBundle(bundleDir)).rejects.toThrow('Invalid bundle.json');
  });

  // EC-20: bundle.json schema mismatch → Error
  // The object has configVersion so it passes the version check, but is
  // missing other required fields (version, built, checksum, etc.).
  it('EC-20: bundle.json schema mismatch throws Error', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      JSON.stringify({ name: 'incomplete', configVersion: '2' }),
      'utf-8'
    );

    await expect(loadBundle(bundleDir)).rejects.toThrow('Invalid bundle.json');
  });

  // EC-21: agent not in bundle → Error with available agent names
  it('EC-21: unknown agent name throws Error containing available agent names', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      makeMinimalBundleJson('known-agent'),
      'utf-8'
    );

    await expect(loadBundle(bundleDir, 'unknown-agent')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.message.includes('unknown-agent') &&
        e.message.includes('known-agent')
    );
  });

  // EC-22: entry.rill missing → Error with file path
  it('EC-22: missing entry.rill throws Error containing the entry file path', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      makeMinimalBundleJson('test-agent'),
      'utf-8'
    );
    // Create the agent directory but do NOT create entry.rill
    await mkdir(path.join(bundleDir, 'agents', 'test-agent'), {
      recursive: true,
    });

    const expectedEntryPath = path.join(
      bundleDir,
      'agents',
      'test-agent',
      'entry.rill'
    );

    await expect(loadBundle(bundleDir, 'test-agent')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error && e.message.includes(expectedEntryPath)
    );
  });

  // EC-14: bundle.json without configVersion → "Bundle format outdated" error
  it('EC-14: bundle.json missing configVersion throws "Bundle format outdated; rebuild" error', async () => {
    const bundleDir = await makeTmpDir();

    // Write a bundle.json that looks valid but lacks configVersion (old format)
    const oldBundle = {
      name: 'test',
      version: '0.1.0',
      built: new Date().toISOString(),
      checksum: 'sha256:abc',
      rillVersion: '0.18.0',
      agents: {
        'test-agent': { configPath: 'agents/test-agent/rill-config.json' },
      },
      // configVersion intentionally absent
    };
    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      JSON.stringify(oldBundle),
      'utf-8'
    );

    await expect(loadBundle(bundleDir, 'test-agent')).rejects.toThrow(
      'Bundle format outdated; rebuild with current bundle tool'
    );
  });
});

// ============================================================
// SUCCESS CASES
// ============================================================

describe('loadBundle success cases', () => {
  // AC-59: single agent in bundle, no name arg → auto-select
  it('AC-59: single agent and no agentName → auto-selects the agent', async () => {
    const bundleDir = await makeBundle('|params: dict = [:]| "hello world" => $run\n"hello world"', 'solo-agent');

    const result = await loadBundle(bundleDir);

    expect(result.agentName).toBe('solo-agent');
    expect(typeof result.handler).toBe('function');
    expect(result.bundleEntry).toBeDefined();
    expect(typeof result.bundleEntry.configPath).toBe('string');
  });
});

// ============================================================
// BUNDLE BUILD ERROR CONTRACTS (AC-40)
// ============================================================

describe('buildBundle error contracts', () => {
  // EC-10: rill-config.json not found → ComposeError('validation')
  it('EC-10: missing rill-config.json throws ComposeError with phase validation', async () => {
    const fixtureDir = await makeTmpDir();
    const bundleDir = await makeTmpDir(BUNDLES_BASE);
    // Do NOT write rill-config.json

    await expect(
      buildBundle(fixtureDir, { outputDir: bundleDir })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'validation' &&
        e.message.includes('rill-config.json')
      );
    });
  });

  // EC-11: local extension source missing → ComposeError('compilation')
  it('EC-11: missing local extension source throws ComposeError with phase compilation', async () => {
    const fixtureDir = await makeTmpDir();
    const bundleDir = await makeTmpDir(BUNDLES_BASE);

    await writeFile(
      path.join(fixtureDir, 'rill-config.json'),
      JSON.stringify({
        name: 'test-agent',
        version: '0.1.0',
        main: 'main.rill:run',
        extensions: { mounts: { myExt: './missing-ext.ts' } },
      }),
      'utf-8'
    );
    await writeFile(path.join(fixtureDir, 'main.rill'), `"hello"`, 'utf-8');

    await expect(
      buildBundle(fixtureDir, { outputDir: bundleDir })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'compilation' &&
        e.message.includes('Extension source not found')
      );
    });
  });

  // EC-12: output dir not writable → ComposeError('bundling')
  it('EC-12: unwritable output dir throws ComposeError with phase bundling', async () => {
    const fixtureDir = await makeTmpDir();
    // Write valid source files
    await writeFile(
      path.join(fixtureDir, 'rill-config.json'),
      JSON.stringify({ name: 'test-agent', version: '0.1.0', main: 'main.rill:run' }),
      'utf-8'
    );
    await writeFile(path.join(fixtureDir, 'main.rill'), `"hello"`, 'utf-8');

    // Create a read-only parent dir so mkdir for outputDir's subdirs fails
    const readOnlyParent = await makeTmpDir(BUNDLES_BASE);
    const blockedOutputDir = path.join(readOnlyParent, 'output');
    await import('node:fs/promises').then(({ chmod }) =>
      chmod(readOnlyParent, 0o000)
    );

    try {
      await expect(
        buildBundle(fixtureDir, { outputDir: blockedOutputDir })
      ).rejects.toSatisfy((e: unknown) => {
        return e instanceof ComposeError && e.phase === 'bundling';
      });
    } finally {
      await import('node:fs/promises').then(({ chmod }) =>
        chmod(readOnlyParent, 0o755)
      );
    }
  });
});
