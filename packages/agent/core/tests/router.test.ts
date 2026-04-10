import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadManifest } from '../src/manifest.js';
import { createRouter } from '../src/router.js';

const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);

// ============================================================
// TEMP DIR MANAGEMENT
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  await mkdir(PKG_ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(PKG_ROOT, 'core-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// SYNTHETIC HANDLER FIXTURE
// ============================================================

function handlerSource(name: string, result: unknown = 'hello world'): string {
  return `
let _initContext = null;

export function describe() {
  return {
    name: ${JSON.stringify(name)},
    params: [{ name: 'input', type: 'string', required: false }],
  };
}

export async function init(context) {
  _initContext = context;
}

export async function execute(request, context) {
  return { state: 'completed', result: ${JSON.stringify(result)} };
}

export async function dispose() {}
`;
}

async function makeAgentDir(
  name: string,
  result: unknown = 'hello world'
): Promise<string> {
  const dir = await makeTmpDir();
  const agentDir = path.join(dir, name);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(agentDir, 'handler.js'),
    handlerSource(name, result),
    'utf-8'
  );
  return dir;
}

// ============================================================
// SINGLE AGENT AUTO-DETECT
// ============================================================

describe('loadManifest single agent', () => {
  it('auto-detects handler.js in directory', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'handler.js'),
      handlerSource('my-agent'),
      'utf-8'
    );

    const manifest = await loadManifest(dir);

    expect(manifest.defaultAgent).toBe('my-agent');
    expect(manifest.agents.size).toBe(1);
    expect(manifest.agents.has('my-agent')).toBe(true);
  });

  it('auto-detects handler.js one level deep', async () => {
    const rootDir = await makeAgentDir('nested-agent');

    const manifest = await loadManifest(rootDir);

    expect(manifest.defaultAgent).toBe('nested-agent');
    expect(manifest.agents.size).toBe(1);
  });

  it('throws when no handler.js found', async () => {
    const dir = await makeTmpDir();

    await expect(loadManifest(dir)).rejects.toThrow(
      'No manifest.json or handler.js'
    );
  });
});

// ============================================================
// MULTI-AGENT MANIFEST
// ============================================================

describe('loadManifest multi-agent', () => {
  it('loads agents from manifest.json', async () => {
    const dir = await makeTmpDir();
    const agentADir = path.join(dir, 'agents', 'agent-a');
    const agentBDir = path.join(dir, 'agents', 'agent-b');
    await mkdir(agentADir, { recursive: true });
    await mkdir(agentBDir, { recursive: true });
    await writeFile(
      path.join(agentADir, 'handler.js'),
      handlerSource('agent-a', 'result-a'),
      'utf-8'
    );
    await writeFile(
      path.join(agentBDir, 'handler.js'),
      handlerSource('agent-b', 'result-b'),
      'utf-8'
    );
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        default: 'agent-a',
        agents: {
          'agent-a': './agents/agent-a',
          'agent-b': './agents/agent-b',
        },
      }),
      'utf-8'
    );

    const manifest = await loadManifest(dir);

    expect(manifest.defaultAgent).toBe('agent-a');
    expect(manifest.agents.size).toBe(2);
    expect(manifest.agents.has('agent-a')).toBe(true);
    expect(manifest.agents.has('agent-b')).toBe(true);
  });
});

// ============================================================
// ROUTER
// ============================================================

describe('createRouter', () => {
  it('initializes agents and routes requests', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'handler.js'),
      handlerSource('test-agent', 'test-result'),
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    const response = await router.run('test-agent', { params: {} });

    expect(response.state).toBe('completed');
    expect(response.result).toBe('test-result');

    await router.dispose();
  });

  it('routes to default agent with empty name', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'handler.js'),
      handlerSource('default-agent', 'default-result'),
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    const response = await router.run('', { params: {} });

    expect(response.result).toBe('default-result');

    await router.dispose();
  });

  it('describe() returns handler description', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'handler.js'),
      handlerSource('described-agent'),
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    const desc = router.describe('described-agent');

    expect(desc).not.toBeNull();
    expect(desc!.name).toBe('described-agent');
    expect(desc!.params).toHaveLength(1);
    expect(desc!.params[0]!.name).toBe('input');

    await router.dispose();
  });

  it('agents() lists all agent names', async () => {
    const dir = await makeTmpDir();
    const agentADir = path.join(dir, 'agents', 'a');
    const agentBDir = path.join(dir, 'agents', 'b');
    await mkdir(agentADir, { recursive: true });
    await mkdir(agentBDir, { recursive: true });
    await writeFile(
      path.join(agentADir, 'handler.js'),
      handlerSource('a'),
      'utf-8'
    );
    await writeFile(
      path.join(agentBDir, 'handler.js'),
      handlerSource('b'),
      'utf-8'
    );
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        default: 'a',
        agents: { a: './agents/a', b: './agents/b' },
      }),
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    expect(router.agents().sort()).toEqual(['a', 'b']);
    expect(router.defaultAgent()).toBe('a');

    await router.dispose();
  });

  it('throws for unknown agent name', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'handler.js'),
      handlerSource('only-agent'),
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    await expect(router.run('nonexistent', { params: {} })).rejects.toThrow(
      'nonexistent'
    );

    await router.dispose();
  });

  it('forwards context.sessionVars to handler.execute (AC-15)', async () => {
    const dir = await makeTmpDir();
    // Handler captures the second argument to execute and returns sessionVars
    await writeFile(
      path.join(dir, 'handler.js'),
      `
let capturedContext = undefined;
export function describe() { return { name: 'ctx-agent', params: [] }; }
export async function init() {}
export async function execute(request, context) {
  capturedContext = context;
  return { state: 'completed', result: context?.sessionVars?.KEY ?? 'none' };
}
export async function dispose() {}
`,
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    const response = await router.run(
      'ctx-agent',
      { params: {} },
      { sessionVars: { KEY: 'val' } }
    );

    expect(response.state).toBe('completed');
    expect(response.result).toBe('val');

    await router.dispose();
  });

  it('run() without context still succeeds (AC-16)', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'handler.js'),
      handlerSource('no-ctx-agent', 'ok'),
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    const response = await router.run('no-ctx-agent', { params: {} });

    expect(response.state).toBe('completed');
    expect(response.result).toBe('ok');

    await router.dispose();
  });

  it('throws correct message for unknown agent (EC-1)', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'handler.js'),
      handlerSource('only-agent'),
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest);

    await expect(router.run('missing', { params: {} })).rejects.toThrow(
      'Agent "missing" not found. Available: only-agent'
    );

    await router.dispose();
  });

  it('passes globalVars to init context', async () => {
    const dir = await makeTmpDir();
    // Handler that captures init context and returns it via execute
    await writeFile(
      path.join(dir, 'handler.js'),
      `
let captured = null;
export function describe() { return { name: 'vars-agent', params: [] }; }
export async function init(context) { captured = context; }
export async function execute() { return { state: 'completed', result: captured?.globalVars?.MY_VAR ?? 'none' }; }
export async function dispose() {}
`,
      'utf-8'
    );

    const manifest = await loadManifest(dir);
    const router = await createRouter(manifest, {
      globalVars: { MY_VAR: 'hello' },
    });

    const response = await router.run('vars-agent', { params: {} });
    expect(response.result).toBe('hello');

    await router.dispose();
  });
});
