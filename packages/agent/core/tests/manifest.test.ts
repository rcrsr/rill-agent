import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadManifest } from '../src/manifest.js';

// ============================================================
// TEMP DIR MANAGEMENT
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), 'rill-agent-core-manifest-')
  );
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

function handlerSource(name: string): string {
  return `
export function describe() {
  return { name: ${JSON.stringify(name)}, params: [] };
}
export async function init() {}
export async function execute() {
  return { state: 'completed', result: 'ok' };
}
export async function dispose() {}
`;
}

// ============================================================
// MANIFEST LOADING
// ============================================================

describe('loadManifest multi-agent edge cases', () => {
  it('throws when the agents map is empty', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ agents: {} }),
      'utf-8'
    );

    await expect(loadManifest(dir)).rejects.toThrow('declares no agents');
  });

  it('throws with the manifest path when manifest.json is malformed', async () => {
    const dir = await makeTmpDir();
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, '{ not valid json', 'utf-8');

    await expect(loadManifest(dir)).rejects.toThrow(manifestPath);
  });

  it('resolves a single agent as the default without an explicit default field', async () => {
    const dir = await makeTmpDir();
    const agentDir = path.join(dir, 'agents', 'only');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, 'handler.js'),
      handlerSource('only'),
      'utf-8'
    );
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ agents: { only: './agents/only' } }),
      'utf-8'
    );

    const manifest = await loadManifest(dir);

    expect(manifest.defaultAgent).toBe('only');
    expect(manifest.agents.size).toBe(1);
  });
});
