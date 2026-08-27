import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import type { AgentRouter } from '@rcrsr/rill-agent';
import { httpHarness } from '../src/index.js';

// ============================================================
// TEMP DIR MANAGEMENT
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'http-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// ROUTER DISPOSAL
// ============================================================

const routers: AgentRouter[] = [];

async function trackedRouter(dir: string): Promise<AgentRouter> {
  const manifest = await loadManifest(dir);
  const router = await createRouter(manifest);
  routers.push(router);
  return router;
}

afterEach(async () => {
  for (const router of routers.splice(0)) {
    await router.dispose().catch(() => undefined);
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

async function makeAgentNoDescribe(_name: string): Promise<string> {
  const dir = await makeTmpDir();
  await writeFile(
    path.join(dir, 'handler.js'),
    `
export function describe() {
  return null;
}
export async function init() {}
export async function execute(request) {
  return { state: 'completed', result: 'ok' };
}
export async function dispose() {}
`,
    'utf-8'
  );
  return dir;
}

async function makeAgentThrowsNotFound(
  name: string,
  message: string
): Promise<string> {
  const dir = await makeTmpDir();
  await writeFile(
    path.join(dir, 'handler.js'),
    `
export function describe() {
  return { name: ${JSON.stringify(name)}, params: [] };
}
export async function init() {}
export async function execute(request) {
  const err = new Error(${JSON.stringify(message)});
  err.code = 'AGENT_NOT_FOUND';
  throw err;
}
export async function dispose() {}
`,
    'utf-8'
  );
  return dir;
}

async function makeAgentThrows(name: string, message: string): Promise<string> {
  const dir = await makeTmpDir();
  await writeFile(
    path.join(dir, 'handler.js'),
    `
export function describe() {
  return { name: ${JSON.stringify(name)}, params: [] };
}
export async function init() {}
export async function execute(request) {
  throw new Error(${JSON.stringify(message)});
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
    const router = await trackedRouter(dir);
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
  });

  it('POST /agents/:name/run executes named agent', async () => {
    const dir = await makeAgent('my-agent', 'named-result');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/my-agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { input: 'test' } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['result']).toBe('named-result');
  });

  it('GET /agents lists agents with descriptions', async () => {
    const dir = await makeAgent('listed-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{ name: string; default: boolean }>;
    };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]!.name).toBe('listed-agent');
    expect(body.agents[0]!.default).toBe(true);
  });

  it('returns 400 for missing required param', async () => {
    const dir = await makeAgent('strict-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('input');
  });

  it('returns 400 for wrong param type', async () => {
    const dir = await makeAgent('typed-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { input: 123 } }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('string');
  });

  it('returns 400 for malformed JSON body', async () => {
    const dir = await makeAgent('json-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON object');
  });

  it('returns 400 for non-object JSON body (array)', async () => {
    const dir = await makeAgent('array-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON object');
  });

  it('returns 400 for non-object JSON body (string)', async () => {
    const dir = await makeAgent('string-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('just a string'),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON object');
  });

  it('returns 400 for null JSON body', async () => {
    const dir = await makeAgent('null-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(null),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON object');
  });

  it('returns 404 for unknown agent', async () => {
    const dir = await makeAgent('known-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/nonexistent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(404);
  });

  it('validateParams returns null when describe() returns null [AC-17]', async () => {
    const dir = await makeAgentNoDescribe('no-describe-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 500 for non-not-found router errors [EC-4]', async () => {
    const dir = await makeAgentThrows('error-agent', 'unexpected failure');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/error-agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('unexpected failure');
  });

  it('routes a structured not-found error through /run as 404, not the hardcoded 500', async () => {
    const dir = await makeAgentThrowsNotFound('ghost-agent', 'ghost gone');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ghost gone');
  });

  it('returns 404 for unknown agent on both routes identically', async () => {
    const dir = await makeAgent('known-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/nonexistent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  it('returns 400 for non-object params (number) on /run', async () => {
    const dir = await makeAgent('params-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: 42 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('params');
  });

  it('returns 400 for non-object params (number) on /agents/:name/run', async () => {
    const dir = await makeAgent('params-agent-2');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/params-agent-2/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: 42 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('params');
  });

  it('returns 400 for negative timeout', async () => {
    const dir = await makeAgent('timeout-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { input: 'hello' }, timeout: -1 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('timeout');
  });

  it('returns 400 for NaN timeout', async () => {
    const dir = await makeAgent('timeout-nan-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/agents/timeout-nan-agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: { input: 'hello' },
        timeout: Number.NaN,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('timeout');
  });

  it('returns 400 for Infinity timeout', async () => {
    const dir = await makeAgent('timeout-inf-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: { input: 'hello' },
        timeout: Number.POSITIVE_INFINITY,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('timeout');
  });

  it('accepts a valid positive finite timeout', async () => {
    const dir = await makeAgent('timeout-ok-agent', 'timed-result');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    const res = await harness.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { input: 'hello' }, timeout: 5000 }),
    });

    expect(res.status).toBe(200);
  });

  it('/run and /agents/:name/run return identical status and body shape for a router error', async () => {
    const dirDefault = await makeAgentThrows('default-error-agent', 'boom');
    const routerDefault = await trackedRouter(dirDefault);
    const harnessDefault = httpHarness(routerDefault);

    const resDefault = await harnessDefault.app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    const dirNamed = await makeAgentThrows('named-error-agent', 'boom');
    const routerNamed = await trackedRouter(dirNamed);
    const harnessNamed = httpHarness(routerNamed);

    const resNamed = await harnessNamed.app.request(
      '/agents/named-error-agent/run',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      }
    );

    expect(resDefault.status).toBe(resNamed.status);
    expect(resDefault.status).toBe(500);
    const bodyDefault = (await resDefault.json()) as { error: string };
    const bodyNamed = (await resNamed.json()) as { error: string };
    expect(bodyDefault.error).toBe('boom');
    expect(bodyNamed.error).toBe('boom');
  });

  it('close() called twice does not throw [AC-20]', async () => {
    const dir = await makeAgent('close-agent');
    const router = await trackedRouter(dir);
    const harness = httpHarness(router);

    await expect(harness.close()).resolves.toBeUndefined();
    await expect(harness.close()).resolves.toBeUndefined();
  });
});
