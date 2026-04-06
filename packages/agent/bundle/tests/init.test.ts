import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/init.js';
import { ComposeError } from '@rcrsr/rill-agent-shared';

// ============================================================
// TEMP DIR + CWD HELPERS
// ============================================================

const tmpDirs: string[] = [];
let originalCwd: string;

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-init-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Restore cwd before cleanup so rm can always succeed
  if (originalCwd) {
    process.chdir(originalCwd);
  }
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// IR-13: initProject creates rill-config.json with :handler suffix
// ============================================================

describe('initProject success cases', () => {
  // ----------------------------------------------------------
  // IR-13: Creates rill-config.json, main.rill, and package.json
  // ----------------------------------------------------------
  it('creates rill-config.json, main.rill, and package.json in new directory [IR-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('test-project');

    const projectDir = path.join(tmpDir, 'test-project');
    expect(existsSync(path.join(projectDir, 'rill-config.json'))).toBe(true);
    expect(existsSync(path.join(projectDir, 'main.rill'))).toBe(true);
    expect(existsSync(path.join(projectDir, 'package.json'))).toBe(true);
  });

  // ----------------------------------------------------------
  // IR-13: Does not create agent.json
  // ----------------------------------------------------------
  it('does not create agent.json [IR-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('test-project');

    const projectDir = path.join(tmpDir, 'test-project');
    expect(existsSync(path.join(projectDir, 'agent.json'))).toBe(false);
  });

  // ----------------------------------------------------------
  // IR-13: rill-config.json has correct name, version, runtime, and main with :handler
  // ----------------------------------------------------------
  it('rill-config.json has name, version, runtime >=0.18.0, and main with :handler suffix [IR-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'rill-config.json'),
      'utf-8'
    );
    const rillConfig = JSON.parse(raw) as Record<string, unknown>;

    expect(rillConfig['name']).toBe('my-agent');
    expect(rillConfig['version']).toBe('0.1.0');
    expect(rillConfig['runtime']).toBe('>=0.18.0');
    expect(rillConfig['main']).toBe('main.rill:handler');
  });

  // ----------------------------------------------------------
  // IR-13: rill-config.json has no functions, assets, or old runtime field
  // ----------------------------------------------------------
  it('rill-config.json has no functions, assets, or @rcrsr/rill@* runtime [IR-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'rill-config.json'),
      'utf-8'
    );
    const rillConfig = JSON.parse(raw) as Record<string, unknown>;

    expect('functions' in rillConfig).toBe(false);
    expect('assets' in rillConfig).toBe(false);
    expect(rillConfig['runtime']).not.toBe('@rcrsr/rill@*');
  });

  // ----------------------------------------------------------
  // IR-13: package.json build script uses rill-agent-bundle build with no path arg
  // ----------------------------------------------------------
  it('package.json build script uses "rill-agent-bundle build" with no path argument [IR-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'package.json'),
      'utf-8'
    );
    const pkgJson = JSON.parse(raw) as Record<string, unknown>;
    const scripts = pkgJson['scripts'] as Record<string, unknown>;

    expect(scripts['build']).toBe('rill-agent-bundle build');
  });

  // ----------------------------------------------------------
  // IR-13: package.json has type: "module" and check script
  // ----------------------------------------------------------
  it('package.json has type: "module" and check script', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'package.json'),
      'utf-8'
    );
    const pkgJson = JSON.parse(raw) as Record<string, unknown>;

    expect(pkgJson['type']).toBe('module');
    const scripts = pkgJson['scripts'] as Record<string, unknown>;
    expect(typeof scripts['check']).toBe('string');
  });

  // ----------------------------------------------------------
  // IR-13: extensions option uses extensions.mounts format
  // ----------------------------------------------------------
  it('extensions option adds entries in extensions.mounts format [IR-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent', {
      extensions: ['@rcrsr/rill-ext-fetch', '@rcrsr/rill-ext-log'],
    });

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'rill-config.json'),
      'utf-8'
    );
    const rillConfig = JSON.parse(raw) as Record<string, unknown>;
    const extensions = rillConfig['extensions'] as Record<string, unknown>;

    expect(typeof extensions['mounts']).toBe('object');
    const mounts = extensions['mounts'] as Record<string, string>;
    expect(mounts['rill-ext-fetch']).toBe('@rcrsr/rill-ext-fetch');
    expect(mounts['rill-ext-log']).toBe('@rcrsr/rill-ext-log');
  });

  // ----------------------------------------------------------
  // IR-13: no extensions option produces no extensions field
  // ----------------------------------------------------------
  it('omits extensions field when no extensions provided [IR-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'rill-config.json'),
      'utf-8'
    );
    const rillConfig = JSON.parse(raw) as Record<string, unknown>;

    expect('extensions' in rillConfig).toBe(false);
  });

  // ----------------------------------------------------------
  // main.rill is created with non-empty content referencing the project name
  // ----------------------------------------------------------
  it('main.rill is created with non-empty content referencing the project name', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const content = await readFile(
      path.join(tmpDir, 'my-agent', 'main.rill'),
      'utf-8'
    );
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('my-agent');
  });
});

// ============================================================
// EC-13: Directory already exists → ComposeError phase 'init'
// ============================================================

describe('initProject error cases', () => {
  // ----------------------------------------------------------
  // EC-13: Directory exists → ComposeError phase 'init'
  // ----------------------------------------------------------
  it('throws ComposeError phase init when directory already exists [EC-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Create the directory first
    await mkdir(path.join(tmpDir, 'existing-project'));

    await expect(initProject('existing-project')).rejects.toSatisfy(
      (e: unknown) => {
        return e instanceof ComposeError && e.phase === 'init';
      }
    );
  });

  it('error message includes the directory name when directory exists [EC-13]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await mkdir(path.join(tmpDir, 'existing-project'));

    await expect(initProject('existing-project')).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof ComposeError &&
          e.phase === 'init' &&
          e.message.includes('existing-project')
        );
      }
    );
  });
});
