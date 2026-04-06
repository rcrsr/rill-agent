/**
 * Integration tests for cli.ts (subprocess-based).
 *
 * Covered:
 *   AC-21  No positional arg + valid bundle in cwd → exits 0, JSON result on stdout
 *   EC-16  No positional arg + cwd lacks bundle → error propagated to stderr, exit 1
 */

import { describe, expect, it, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '@rcrsr/rill-agent-bundle';

// Resolve the compiled CLI path relative to the package root.
// dist/cli.js is built by `pnpm run build` (tsc --build).
const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);
const CLI_PATH = path.join(PKG_ROOT, 'dist', 'cli.js');

// Bundle output must be placed under PKG_ROOT so that handlers.js can resolve
// @rcrsr/rill-agent-harness via this package's node_modules directory.
const BUNDLES_BASE = path.join(PKG_ROOT, '.test-bundles');

// ============================================================
// RILL SCRIPT FIXTURE
// ============================================================

/** Returns the string "hello world" via a handler callable named $run */
const HELLO_SCRIPT = `|params: dict = [:]| "hello world" => $run\n"hello world"`;

function makeRillConfig(name: string): Record<string, unknown> {
  return { name, version: '0.1.0', main: 'main.rill:run' };
}

// ============================================================
// TEMP DIR SETUP
// ============================================================

const tmpDirs: string[] = [];

function makeTmpDirSync(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'rill-cli-test-'));
  tmpDirs.push(dir);
  return dir;
}

async function makeTmpDirAsync(base: string): Promise<string> {
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'cli-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// BUNDLE FIXTURE HELPER
// ============================================================

/**
 * Builds a real bundle for use in CLI subprocess tests.
 * Output must be under PKG_ROOT for node_modules resolution in handlers.js.
 */
async function makeBundle(
  script: string,
  agentName = 'test-agent'
): Promise<string> {
  const fixtureDir = await makeTmpDirAsync(PKG_ROOT);
  const bundleDir = await makeTmpDirAsync(BUNDLES_BASE);

  await writeFile(
    path.join(fixtureDir, 'rill-config.json'),
    JSON.stringify(makeRillConfig(agentName), null, 2),
    'utf-8'
  );
  await writeFile(path.join(fixtureDir, 'main.rill'), script, 'utf-8');

  await buildBundle(fixtureDir, { outputDir: bundleDir });

  return bundleDir;
}

// ============================================================
// AC-21: NO POSITIONAL ARG, VALID BUNDLE IN CWD
// ============================================================

describe('CLI AC-21: no positional arg, valid bundle in cwd', () => {
  // AC-21: When no positional arg is provided, cli.ts defaults to cwd.
  // A valid bundle in cwd must load and execute successfully: exit 0, JSON on stdout.
  it('AC-21: exits 0 and writes JSON result to stdout when cwd contains a valid bundle', async () => {
    const bundleDir = await makeBundle(HELLO_SCRIPT);

    const result = spawnSync('node', [CLI_PATH], {
      cwd: bundleDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    expect(result.status).toBe(0);
    const stdout = result.stdout ?? '';
    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toBe('hello world');
  });
});

// ============================================================
// EC-16: NO POSITIONAL ARG, CWD LACKS BUNDLE FILES
// ============================================================

describe('CLI EC-16: no positional arg, cwd lacks bundle', () => {
  // EC-16: When no positional arg is provided, cli.ts uses cwd as bundleDir.
  // If cwd has no bundle.json, loadBundle fails and the error must reach stderr
  // with exit code 1.
  it('EC-16: exits 1 and writes error to stderr when cwd has no bundle', () => {
    const emptyDir = makeTmpDirSync();

    const result = spawnSync('node', [CLI_PATH], {
      cwd: emptyDir,
      encoding: 'utf-8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    // The error message should mention the missing bundle directory
    const stderr = result.stderr ?? '';
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toMatch(/Error:/);
  });
});
