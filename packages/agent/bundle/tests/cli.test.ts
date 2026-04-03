/**
 * Integration tests for cli.ts (subprocess-based).
 *
 * Covered:
 *   AC-20  `rill-agent-bundle build` with no positional arg defaults to cwd and succeeds
 */

import { describe, expect, it, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// PATHS
// ============================================================

const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);
const CLI_PATH = path.join(PKG_ROOT, 'dist', 'cli.js');

// ============================================================
// FIXTURES
// ============================================================

const MINIMAL_RILL_CONFIG = JSON.stringify(
  {
    name: 'test-agent',
    version: '0.1.0',
    main: 'main.rill:run',
  },
  null,
  2
);

const MINIMAL_RILL_SCRIPT = `"hello world"`;

// ============================================================
// TEMP DIR HELPERS
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-bundle-cli-test-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Creates a minimal project fixture with rill-config.json and main.rill.
 * Returns the project directory path.
 */
async function makeProjectFixture(): Promise<string> {
  const projectDir = await makeTmpDir();
  await writeFile(
    path.join(projectDir, 'rill-config.json'),
    MINIMAL_RILL_CONFIG,
    'utf-8'
  );
  await writeFile(
    path.join(projectDir, 'main.rill'),
    MINIMAL_RILL_SCRIPT,
    'utf-8'
  );
  return projectDir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// AC-20: NO POSITIONAL ARG, DEFAULTS TO CWD
// ============================================================

describe('CLI AC-20: build with no positional arg defaults to cwd', () => {
  // AC-20: When no positional arg is given, cli.ts uses process.cwd() as the
  // project directory. If cwd contains a valid rill-config.json and .rill entry
  // file, the build must succeed with exit code 0 and write the bundle output
  // path to stdout.
  it('AC-20: exits 0 and writes output path to stdout when cwd has valid project', async () => {
    const projectDir = await makeProjectFixture();

    const result = spawnSync('node', [CLI_PATH, 'build'], {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    expect(result.status).toBe(0);
    const stdout = result.stdout ?? '';
    expect(stdout.trim().length).toBeGreaterThan(0);
  });
});
