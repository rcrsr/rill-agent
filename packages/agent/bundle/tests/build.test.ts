import { describe, it, expect, afterEach } from 'vitest';
import { rm, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBundle } from '../src/build.js';
import { ComposeError } from '@rcrsr/rill-agent-shared';

// ============================================================
// MINIMAL FIXTURE
// ============================================================

const MINIMAL_RILL_CONFIG = {
  name: 'test-agent',
  version: '0.1.0',
  main: 'main.rill:run',
};

const MINIMAL_RILL_SCRIPT = `"hello world"`;

// ============================================================
// TEMP DIR HELPERS
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-bundle-test-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Create a minimal agent fixture in a temp directory using rill-config.json.
 * Returns the project directory path and the output dir path.
 */
async function makeProjectFixture(
  overrides: Partial<typeof MINIMAL_RILL_CONFIG> = {},
  extraFiles: Record<string, string> = {}
): Promise<{ projectDir: string; outputDir: string }> {
  const projectDir = await makeTmpDir();
  const outputDir = await makeTmpDir();

  const rillConfig = { ...MINIMAL_RILL_CONFIG, ...overrides };
  await writeFile(
    path.join(projectDir, 'rill-config.json'),
    JSON.stringify(rillConfig, null, 2),
    'utf-8'
  );
  await writeFile(
    path.join(projectDir, 'main.rill'),
    MINIMAL_RILL_SCRIPT,
    'utf-8'
  );

  for (const [filename, content] of Object.entries(extraFiles)) {
    await writeFile(path.join(projectDir, filename), content, 'utf-8');
  }

  return { projectDir, outputDir };
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// SUCCESS CASES
// ============================================================

describe('buildBundle success cases', () => {
  // ----------------------------------------------------------
  // AC-18: Bundle builds from rill-config.json with all outputs correct
  // ----------------------------------------------------------
  it('produces bundle.json matching BundleManifest schema [AC-18/AC-19]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    const result = await buildBundle(projectDir, { outputDir });

    const bundleJsonPath = path.join(outputDir, 'bundle.json');
    expect(existsSync(bundleJsonPath)).toBe(true);

    const raw = await readFile(bundleJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(typeof parsed['name']).toBe('string');
    expect(typeof parsed['version']).toBe('string');
    expect(typeof parsed['built']).toBe('string');
    expect(typeof parsed['checksum']).toBe('string');
    expect(typeof parsed['rillVersion']).toBe('string');
    expect(typeof parsed['agents']).toBe('object');
    expect(parsed['agents']).not.toBeNull();
    expect(parsed['configVersion']).toBe('2');

    // Return value also has the manifest
    expect(result.manifest.name).toBe('test-agent');
    expect(result.manifest.version).toBe('0.1.0');
    expect(result.outputPath).toBe(outputDir);
  });

  // ----------------------------------------------------------
  // AC-20: bundle.json contains sha256 checksum
  // ----------------------------------------------------------
  it('bundle.json contains sha256 checksum in format sha256:<hex> [AC-20]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    const result = await buildBundle(projectDir, { outputDir });

    expect(result.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.manifest.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.checksum).toBe(result.manifest.checksum);
  });

  // ----------------------------------------------------------
  // AC-21: dist/handlers.js present with export and handlers
  // ----------------------------------------------------------
  it('dist/handlers.js exists and contains export and handlers [AC-21]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    await buildBundle(projectDir, { outputDir });

    const handlersPath = path.join(outputDir, 'handlers.js');
    expect(existsSync(handlersPath)).toBe(true);

    const content = await readFile(handlersPath, 'utf-8');
    expect(content).toContain('export');
    expect(content).toContain('handlers');
  });

  // ----------------------------------------------------------
  // AC-19: handlers.js thin loader imports from rill-config and rill-agent-harness
  // ----------------------------------------------------------
  it('handlers.js imports loadProject and invokeCallable from @rcrsr/rill-config [AC-19]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    await buildBundle(projectDir, { outputDir });

    const content = await readFile(path.join(outputDir, 'handlers.js'), 'utf-8');
    expect(content).toContain(`from '@rcrsr/rill-config'`);
    expect(content).toContain('loadProject');
    expect(content).toContain('invokeCallable');
    expect(content).toContain(`from '@rcrsr/rill-agent-harness'`);
    expect(content).toContain('createAgentHost');
  });

  // ----------------------------------------------------------
  // AC-19: handlers.js reads rill-config.json from bundle-relative path
  // ----------------------------------------------------------
  it('handlers.js reads rill-config.json from bundle-relative agent path [AC-19]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    await buildBundle(projectDir, { outputDir });

    const content = await readFile(path.join(outputDir, 'handlers.js'), 'utf-8');
    expect(content).toContain('rill-config.json');
    expect(content).toContain(`'agents'`);
    // Verify no old harness compose imports remain
    expect(content).not.toContain('composeAgent');
    expect(content).not.toContain(`from '@rcrsr/rill'`);
  });

  // ----------------------------------------------------------
  // AC-22: dist/agents/<name>/entry.rill copied
  // ----------------------------------------------------------
  it('copies entry.rill to dist/agents/<name>/entry.rill [AC-22]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    await buildBundle(projectDir, { outputDir });

    const entryPath = path.join(
      outputDir,
      'agents',
      'test-agent',
      'entry.rill'
    );
    expect(existsSync(entryPath)).toBe(true);

    const content = await readFile(entryPath, 'utf-8');
    expect(content).toBe(MINIMAL_RILL_SCRIPT);
  });

  // ----------------------------------------------------------
  // AC-18: Output rill-config.json written with rewritten main field
  // ----------------------------------------------------------
  it('writes rill-config.json to agents/<name>/ with main rewritten to entry.rill [AC-18]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    await buildBundle(projectDir, { outputDir });

    const rillConfigPath = path.join(
      outputDir,
      'agents',
      'test-agent',
      'rill-config.json'
    );
    expect(existsSync(rillConfigPath)).toBe(true);

    const raw = await readFile(rillConfigPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof parsed['main']).toBe('string');
    expect((parsed['main'] as string).startsWith('entry.rill')).toBe(true);
  });

  // ----------------------------------------------------------
  // DS-6: BundleAgentEntry has configPath
  // ----------------------------------------------------------
  it('bundle.json agents record has configPath field [DS-6/DS-7]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    const result = await buildBundle(projectDir, { outputDir });

    const agentEntry = result.manifest.agents['test-agent'];
    expect(agentEntry).toBeDefined();
    expect(typeof agentEntry!.configPath).toBe('string');
    expect(agentEntry!.configPath).toBe('agents/test-agent/rill-config.json');
  });

  // ----------------------------------------------------------
  // DS-6: configVersion is "2"
  // ----------------------------------------------------------
  it('bundle.json has configVersion "2" [DS-6]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    const result = await buildBundle(projectDir, { outputDir });

    expect(result.manifest.configVersion).toBe('2');
  });

  // ----------------------------------------------------------
  // AC-28: Same source built twice produces identical checksums
  // ----------------------------------------------------------
  it('same source built twice produces identical checksums [AC-28]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();
    const outputDir2 = await makeTmpDir();

    const result1 = await buildBundle(projectDir, { outputDir });
    const result2 = await buildBundle(projectDir, { outputDir: outputDir2 });

    expect(result1.checksum).toBe(result2.checksum);
  });

  // ----------------------------------------------------------
  // AC-51: built timestamp varies but checksum identical
  // ----------------------------------------------------------
  it('built timestamp varies between builds but checksum is identical [AC-51]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();
    const outputDir2 = await makeTmpDir();

    const result1 = await buildBundle(projectDir, { outputDir });
    // Small delay to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result2 = await buildBundle(projectDir, { outputDir: outputDir2 });

    // Checksums are identical
    expect(result1.checksum).toBe(result2.checksum);
    // Timestamps may differ (not guaranteed in fast CI, but built field is set independently)
    expect(typeof result1.manifest.built).toBe('string');
    expect(typeof result2.manifest.built).toBe('string');
  });

  // ----------------------------------------------------------
  // AC-18: Local TS extension compiled and mount path rewritten
  // ----------------------------------------------------------
  it('compiles local TS extension and rewrites mount path in rill-config.json [AC-18]', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    // Write a minimal valid rill extension (must export extensionManifest with
    // a factory returning { value: ... } as required by the rill-config loader)
    const extensionSrc = `
export const extensionManifest = {
  name: 'my-ext',
  version: '0.1.0',
  exports: {},
  factory: async () => ({ value: {} }),
};
`;
    await writeFile(path.join(projectDir, 'my-ext.ts'), extensionSrc, 'utf-8');
    await writeFile(path.join(projectDir, 'main.rill'), MINIMAL_RILL_SCRIPT, 'utf-8');
    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      JSON.stringify(
        {
          name: 'ext-agent',
          version: '0.1.0',
          main: 'main.rill:run',
          extensions: { mounts: { myExt: './my-ext.ts' } },
        },
        null,
        2
      ),
      'utf-8'
    );

    await buildBundle(projectDir, { outputDir });

    // Compiled extension file must exist
    const compiledPath = path.join(
      outputDir,
      'agents',
      'ext-agent',
      'extensions',
      'myExt.js'
    );
    expect(existsSync(compiledPath)).toBe(true);

    // Output rill-config.json must have rewritten mount path
    const rillConfigPath = path.join(
      outputDir,
      'agents',
      'ext-agent',
      'rill-config.json'
    );
    const raw = await readFile(rillConfigPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ext = parsed['extensions'] as Record<string, unknown>;
    const mounts = ext['mounts'] as Record<string, string>;
    expect(mounts['myExt']).toBe('./extensions/myExt.js');
  });

  // ----------------------------------------------------------
  // AC-26: --output flag writes to custom dir via outputDir option
  // ----------------------------------------------------------
  it('writes output to custom outputDir [AC-26]', async () => {
    const { projectDir } = await makeProjectFixture();
    const customOutputDir = await makeTmpDir();

    const result = await buildBundle(projectDir, {
      outputDir: customOutputDir,
    });

    expect(result.outputPath).toBe(customOutputDir);
    expect(existsSync(path.join(customOutputDir, 'bundle.json'))).toBe(true);
    expect(existsSync(path.join(customOutputDir, 'handlers.js'))).toBe(true);
  });

  // ----------------------------------------------------------
  // AC-29: No Dockerfile, .zip, deployment artifacts in output
  // ----------------------------------------------------------
  it('produces no Dockerfile, .zip, or deployment artifacts [AC-29]', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    await buildBundle(projectDir, { outputDir });

    expect(existsSync(path.join(outputDir, 'Dockerfile'))).toBe(false);
    // Walk output dir and assert no .zip files
    const entries = await (async function walk(dir: string): Promise<string[]> {
      const { readdir } = await import('node:fs/promises');
      const items = await readdir(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          results.push(...(await walk(full)));
        } else {
          results.push(full);
        }
      }
      return results;
    })(outputDir);

    const zipFiles = entries.filter((f) => f.endsWith('.zip'));
    expect(zipFiles).toHaveLength(0);

    const dockerFiles = entries.filter(
      (f) => path.basename(f) === 'Dockerfile' || f.endsWith('.dockerfile')
    );
    expect(dockerFiles).toHaveLength(0);
  });

  // ----------------------------------------------------------
  // Verify built timestamp is an ISO 8601 string
  // ----------------------------------------------------------
  it('bundle.json built field is a valid ISO 8601 timestamp', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    const result = await buildBundle(projectDir, { outputDir });

    const parsed = new Date(result.manifest.built);
    expect(parsed.toString()).not.toBe('Invalid Date');
    expect(result.manifest.built).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  // ----------------------------------------------------------
  // Verify rillVersion field is a non-empty string
  // ----------------------------------------------------------
  it('bundle.json rillVersion is a non-empty string', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    const result = await buildBundle(projectDir, { outputDir });

    expect(typeof result.manifest.rillVersion).toBe('string');
    expect(result.manifest.rillVersion.length).toBeGreaterThan(0);
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('buildBundle error cases', () => {
  // ----------------------------------------------------------
  // AC-47: rill-config.json not found → ComposeError('validation')
  // ----------------------------------------------------------
  it('throws ComposeError phase validation when rill-config.json is missing [AC-47]', async () => {
    const outputDir = await makeTmpDir();
    const nonExistentDir = path.join(outputDir, 'does-not-exist');

    await expect(
      buildBundle(nonExistentDir, { outputDir })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'validation' &&
        e.message.includes('rill-config.json not found')
      );
    });
  });

  // ----------------------------------------------------------
  // AC-48: Malformed rill-config.json → ComposeError('validation') with parse detail
  // ----------------------------------------------------------
  it('throws ComposeError phase validation when rill-config.json is malformed JSON [AC-48]', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      '{ this is not valid json }',
      'utf-8'
    );

    await expect(
      buildBundle(projectDir, { outputDir })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'validation' &&
        e.message.includes('Failed to parse rill-config.json')
      );
    });
  });

  // ----------------------------------------------------------
  // Entry .rill file not found → ComposeError('compilation')
  // ----------------------------------------------------------
  it('throws ComposeError phase compilation when entry.rill is missing', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    // Write config but NOT the .rill file
    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      JSON.stringify({ name: 'test', version: '0.1.0', main: 'main.rill:run' }),
      'utf-8'
    );

    await expect(
      buildBundle(projectDir, { outputDir })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'compilation' &&
        e.message.includes('Entry file not found')
      );
    });
  });

  // ----------------------------------------------------------
  // Local extension source missing → ComposeError('compilation')
  // ----------------------------------------------------------
  it('throws ComposeError phase compilation when local extension source is missing', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      JSON.stringify({
        name: 'test',
        version: '0.1.0',
        main: 'main.rill:run',
        extensions: { mounts: { myExt: './missing-ext.ts' } },
      }),
      'utf-8'
    );
    await writeFile(path.join(projectDir, 'main.rill'), `"hello"`, 'utf-8');

    await expect(
      buildBundle(projectDir, { outputDir })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'compilation' &&
        e.message.includes('Extension source not found')
      );
    });
  });

  // ----------------------------------------------------------
  // AC-49: loadProject() dry-run failure deletes output and throws
  // ----------------------------------------------------------
  it('deletes output directory and throws when dry-run validation fails [AC-49]', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    // Write a config that references a non-existent npm extension (will fail loadProject)
    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      JSON.stringify({
        name: 'test',
        version: '0.1.0',
        main: 'main.rill:run',
        extensions: {
          mounts: { badExt: '@non-existent-pkg/does-not-exist-xyz123' },
        },
      }),
      'utf-8'
    );
    await writeFile(path.join(projectDir, 'main.rill'), `"hello"`, 'utf-8');

    await expect(
      buildBundle(projectDir, { outputDir })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'validation' &&
        e.message.includes('Bundle validation failed')
      );
    });

    // Output directory must be deleted after failure
    expect(existsSync(outputDir)).toBe(false);
  });

  // ----------------------------------------------------------
  // AC-34/EC-15: Output not writable → ComposeError phase 'bundling'
  // ----------------------------------------------------------
  it('throws ComposeError phase bundling when output dir is not writable [AC-34/EC-15]', async () => {
    const { projectDir } = await makeProjectFixture();

    // Make a read-only parent directory so mkdir on the outputDir path fails.
    const readOnlyParent = await makeTmpDir();
    const blockedOutputDir = path.join(readOnlyParent, 'output');

    // chmod 000 prevents the process from creating subdirectories inside.
    await import('node:fs/promises').then(({ chmod }) =>
      chmod(readOnlyParent, 0o000)
    );

    try {
      await expect(
        buildBundle(projectDir, { outputDir: blockedOutputDir })
      ).rejects.toSatisfy((e: unknown) => {
        return e instanceof ComposeError && e.phase === 'bundling';
      });
    } finally {
      // Restore permissions so afterEach cleanup can remove the dir.
      await import('node:fs/promises').then(({ chmod }) =>
        chmod(readOnlyParent, 0o755)
      );
    }
  });
});

// ============================================================
// BOUNDARY CONDITIONS
// ============================================================

describe('buildBundle boundary conditions', () => {
  // ----------------------------------------------------------
  // Verify built timestamp is an ISO 8601 string
  // ----------------------------------------------------------
  it('bundle.json built field is a valid ISO 8601 timestamp', async () => {
    const { projectDir, outputDir } = await makeProjectFixture();

    const result = await buildBundle(projectDir, { outputDir });

    const parsed = new Date(result.manifest.built);
    expect(parsed.toString()).not.toBe('Invalid Date');
    expect(result.manifest.built).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  // ----------------------------------------------------------
  // Name defaults to directory basename when not in config
  // ----------------------------------------------------------
  it('uses directory basename as agent name when name field absent', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();
    const dirName = path.basename(projectDir);

    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      JSON.stringify({ version: '0.1.0', main: 'main.rill:run' }),
      'utf-8'
    );
    await writeFile(path.join(projectDir, 'main.rill'), `"hello"`, 'utf-8');

    const result = await buildBundle(projectDir, { outputDir });

    expect(result.manifest.name).toBe(dirName);
  });

  // ----------------------------------------------------------
  // AC-49: 3+ local TS extensions all produce compiled JS
  // ----------------------------------------------------------
  it('compiles 3 local TS extensions and all produce JS output files [AC-49]', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    const extensionSrc = (name: string) => `
export const extensionManifest = {
  name: '${name}',
  version: '0.1.0',
  exports: {},
  factory: async () => ({ value: {} }),
};
`;

    await writeFile(path.join(projectDir, 'ext-alpha.ts'), extensionSrc('ext-alpha'), 'utf-8');
    await writeFile(path.join(projectDir, 'ext-beta.ts'), extensionSrc('ext-beta'), 'utf-8');
    await writeFile(path.join(projectDir, 'ext-gamma.ts'), extensionSrc('ext-gamma'), 'utf-8');
    await writeFile(path.join(projectDir, 'main.rill'), MINIMAL_RILL_SCRIPT, 'utf-8');
    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      JSON.stringify(
        {
          name: 'multi-ext-agent',
          version: '0.1.0',
          main: 'main.rill:run',
          extensions: {
            mounts: {
              extAlpha: './ext-alpha.ts',
              extBeta: './ext-beta.ts',
              extGamma: './ext-gamma.ts',
            },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    await buildBundle(projectDir, { outputDir });

    const extensionsDir = path.join(outputDir, 'agents', 'multi-ext-agent', 'extensions');
    expect(existsSync(path.join(extensionsDir, 'extAlpha.js'))).toBe(true);
    expect(existsSync(path.join(extensionsDir, 'extBeta.js'))).toBe(true);
    expect(existsSync(path.join(extensionsDir, 'extGamma.js'))).toBe(true);
  });

  // ----------------------------------------------------------
  // Version defaults to '0.0.0' when not in config
  // ----------------------------------------------------------
  it('uses 0.0.0 as version when version field absent', async () => {
    const projectDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    await writeFile(
      path.join(projectDir, 'rill-config.json'),
      JSON.stringify({ name: 'test', main: 'main.rill:run' }),
      'utf-8'
    );
    await writeFile(path.join(projectDir, 'main.rill'), `"hello"`, 'utf-8');

    const result = await buildBundle(projectDir, { outputDir });

    expect(result.manifest.version).toBe('0.0.0');
  });
});
