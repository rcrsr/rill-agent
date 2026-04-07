import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadManifest } from '../src/manifest.js';
import { createRouter } from '../src/router.js';
import { httpHarness } from '../src/harness/http.js';

const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);

// ============================================================
// TEMP DIR MANAGEMENT
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  await mkdir(PKG_ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(PKG_ROOT, 'http-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// FIXTURE
// ============================================================

async function makeAgent(
  name: string,
  result: unknown = 'hello'
): Promise<string> {
  const dir = await makeTmpDir();
  await writeFile(
    path.join(dir, 'handler.js'),
    `
export function describe() {
  return {
    name: ${JSON.stringify(name)},
    params: [
      { name: 'input', type: 'string', required: true },
      { name: 'count', type: 'number', required: false },
    ],
  };
}
export async function init() {}
export async function execute(request) {
  return { state: 'completed', result: ${JSON.stringify(result)} };
}
export async function dispose() {}
`,
    'utf-8'
  );
  return dir;
}

// ============================================================
// HTTP HARNESS TESTS
// ============================================================

describe('httpHarness', () => {
  it('POST /run executes default agent', async () => {
    const dir = await makeAgent('test-agent', 'test-result');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { input: 'hello' } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['state']).toBe('completed');
    expect(body['result']).toBe('test-result');

    await router.dispose();
  });

  it('POST /agents/:name/run executes named agent', async () => {
    const dir = await makeAgent('my-agent', 'named-result');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/my-agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { input: 'test' } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['result']).toBe('named-result');

    await router.dispose();
  });

  it('GET /agents lists agents with descriptions', async () => {
    const dir = await makeAgent('listed-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{ name: string; default: boolean }>;
    };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]!.name).toBe('listed-agent');
    expect(body.agents[0]!.default).toBe(true);

    await router.dispose();
  });

  it('returns 400 for missing required param', async () => {
    const dir = await makeAgent('strict-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('input');

    await router.dispose();
  });

  it('returns 400 for wrong param type', async () => {
    const dir = await makeAgent('typed-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { input: 123 } }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('string');

    await router.dispose();
  });

  it('returns 400 for malformed JSON body', async () => {
    const dir = await makeAgent('json-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid JSON');

    await router.dispose();
  });

  it('returns 400 for non-object JSON body (array)', async () => {
    const dir = await makeAgent('array-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON object');

    await router.dispose();
  });

  it('returns 400 for non-object JSON body (string)', async () => {
    const dir = await makeAgent('string-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('just a string'),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON object');

    await router.dispose();
  });

  it('returns 400 for null JSON body', async () => {
    const dir = await makeAgent('null-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(null),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON object');

    await router.dispose();
  });

  it('returns 404 for unknown agent', async () => {
    const dir = await makeAgent('known-agent');
    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/nonexistent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(404);

    await router.dispose();
  });
});
