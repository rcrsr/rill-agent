import { describe, expect, it } from 'vitest';
import type { AgentHandler } from '@rcrsr/rill-agent';
import { createChatHarness } from '../src/index.js';
import {
  jsonPost,
  makeChatHandler,
  makeRouter,
  makeRpcHandler,
  parseSseFrames,
  readBody,
  vi,
} from './_fixtures.js';

// ============================================================
// SSE PARSING HELPER
// ============================================================

async function readSseFrames(response: Response): Promise<string[]> {
  const body = await readBody(response);
  return parseSseFrames(body);
}

// ============================================================
// VALID MESSAGES BODY
// ============================================================

const VALID_BODY = jsonPost({
  messages: [{ role: 'user', content: 'hello' }],
});

// ============================================================
// PER-AGENT CHAT ROUTE
// ============================================================

describe('POST /agents/:name/chat — valid agent streams chunks', () => {
  it('returns 200 text/event-stream with chunk frames and [DONE]', async () => {
    const invoked = vi.fn();
    const handler = makeChatHandler({ name: 'alpha', onInvoke: invoked });
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([['alpha', handler]]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/agents/alpha/chat',
      jsonPost({ messages: [{ role: 'user', content: 'hello' }], stream: true })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const dataFrames = (await readSseFrames(res)).filter((f) =>
      f.startsWith('data: ')
    );
    expect(dataFrames.length).toBeGreaterThanOrEqual(1);
    expect(dataFrames[dataFrames.length - 1]).toBe('data: [DONE]');
    expect(invoked).toHaveBeenCalledOnce();
  });
});

// ============================================================
// DISCOVERY ROUTE — FILTERS NON-CHAT HANDLERS
// ============================================================

describe('GET /agents — filters out non-chat handlers', () => {
  it('returns only chat-eligible agents in the agents array', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
        ['beta', makeChatHandler({ name: 'beta' })],
        ['rpc-only', makeRpcHandler('rpc-only')],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/agents');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      agents: Array<{ name: string; default?: boolean }>;
    };
    const names = body.agents.map((a) => a.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).not.toContain('rpc-only');
  });

  it('marks the default agent with default:true', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
        ['beta', makeChatHandler({ name: 'beta' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/agents');
    const body = (await res.json()) as {
      agents: Array<{ name: string; default?: boolean }>;
    };
    expect(body.agents.find((a) => a.name === 'alpha')?.default).toBe(true);
    expect(body.agents.find((a) => a.name === 'beta')?.default).toBe(false);
  });
});

// ============================================================
// OPENAI-COMPATIBLE ROUTE — UNKNOWN MODEL FALLS BACK TO DEFAULT
// ============================================================

describe('POST /v1/chat/completions — unknown model routes to default agent', () => {
  it('invokes the default agent when model does not match any known agent', async () => {
    const alphaInvoked = vi.fn();
    const betaInvoked = vi.fn();
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha', onInvoke: alphaInvoked })],
        ['beta', makeChatHandler({ name: 'beta', onInvoke: betaInvoked })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({
        model: 'nonexistent',
        messages: [{ role: 'user', content: 'hi' }],
      })
    );

    expect(res.status).toBe(200);
    await readSseFrames(res);
    expect(alphaInvoked).toHaveBeenCalledOnce();
    expect(betaInvoked).not.toHaveBeenCalled();
  });
});

// ============================================================
// OPENAI-COMPATIBLE ROUTE — MISSING MODEL FALLS BACK TO DEFAULT
// ============================================================

describe('POST /v1/chat/completions — missing model routes to default agent', () => {
  it('invokes the default agent when model field is absent', async () => {
    const alphaInvoked = vi.fn();
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha', onInvoke: alphaInvoked })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ messages: [{ role: 'user', content: 'hi' }] })
    );

    expect(res.status).toBe(200);
    await readSseFrames(res);
    expect(alphaInvoked).toHaveBeenCalledOnce();
  });
});

// ============================================================
// DEFAULT CHAT ROUTE — POST /chat
// ============================================================

describe('POST /chat — invokes default agent and streams', () => {
  it('returns 200 SSE and invokes the default agent handler', async () => {
    const invoked = vi.fn();
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha', onInvoke: invoked })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/chat',
      jsonPost({ messages: [{ role: 'user', content: 'hello' }], stream: true })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const dataFrames = (await readSseFrames(res)).filter((f) =>
      f.startsWith('data: ')
    );
    expect(dataFrames.length).toBeGreaterThanOrEqual(1);
    expect(dataFrames[dataFrames.length - 1]).toBe('data: [DONE]');
    expect(invoked).toHaveBeenCalledOnce();
  });
});

// ============================================================
// UNKNOWN AGENT — 404
// ============================================================

describe('POST /agents/unknown/chat — unknown agent returns 404', () => {
  it('returns 404 JSON with error message when agent name is not registered', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/agents/unknown/chat', VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error: { message: string } };
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});

// ============================================================
// HANDLER REMOVED AFTER CONSTRUCTION — 500
// ============================================================

describe('POST /chat — 500 when the default agent handler becomes inaccessible', () => {
  // The harness throws ChatSignatureError at construction when the default
  // agent is missing or ineligible while the defaultAgent route is enabled.
  // The 500 branch in the request path covers post-construction tampering —
  // the handler removed from the router's manifest map after the harness
  // captured eligibility. Tests reach that branch by mutating the underlying
  // agents Map after createChatHarness returns.
  it('returns 500 JSON when the handler is removed from the manifest after construction', async () => {
    const agents = new Map<string, AgentHandler>([
      ['alpha', makeChatHandler({ name: 'alpha' })],
    ]);
    const router = await makeRouter({ agents, defaultAgent: 'alpha' });
    const harness = createChatHarness(router);

    // Mutate the agents map the router holds — the chat harness's per-request
    // lookup goes through router.manifest.agents and now sees undefined.
    agents.delete('alpha');

    const res = await harness.app.request('/chat', VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error: { message: string } };
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});

// ============================================================
// VALIDATION ERRORS
// ============================================================

describe('POST /chat — empty messages array returns 400', () => {
  it('returns exact error message for empty array', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/chat', jsonPost({ messages: [] }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('messages must be a non-empty array');
  });
});

describe('POST /chat — non-array messages returns 400', () => {
  it('returns exact error message for string instead of array', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/chat',
      jsonPost({ messages: 'not-array' })
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('messages must be an array');
  });
});

describe('POST /chat — invalid role returns 400 with index', () => {
  it('returns indexed role error for unrecognized role', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/chat',
      jsonPost({ messages: [{ role: 'bot', content: 'x' }] })
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      'messages[0].role must be one of: system, user, assistant'
    );
  });
});

describe('POST /chat — non-string content returns 400 with index', () => {
  it('returns indexed content error for numeric content', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/chat',
      jsonPost({ messages: [{ role: 'user', content: 42 }] })
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('messages[0].content must be a string');
  });
});

// ============================================================
// CORS
// ============================================================

describe('CORS — no options', () => {
  it('does not include access-control-allow-origin when cors is not configured', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/health');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('CORS — cors:true', () => {
  it('includes access-control-allow-origin on all routes when cors is true', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router, { cors: true });

    const res = await harness.app.request('/health', {
      headers: { Origin: 'http://example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBeNull();
  });
});

// ============================================================
// HEALTH ROUTE
// ============================================================

describe('GET /health', () => {
  it('returns 200 with body "OK" before listen()', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });

  it('returns 200 with body "OK" after close()', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    await harness.listen(0);
    await harness.close();

    const res = await harness.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});

// ============================================================
// METRICS ROUTE
// ============================================================

describe('GET /metrics', () => {
  it('returns 200 JSON with numeric requests, errors, active_connections', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/metrics');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      requests: number;
      errors: number;
      active_connections: number;
    };
    expect(typeof body.requests).toBe('number');
    expect(typeof body.errors).toBe('number');
    expect(typeof body.active_connections).toBe('number');
  });

  it('increments requests counter after completing chat requests', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const before = (
      (await (await harness.app.request('/metrics')).json()) as {
        requests: number;
      }
    ).requests;

    for (let i = 0; i < 2; i++) {
      const res = await harness.app.request('/chat', VALID_BODY);
      await readSseFrames(res);
    }

    const after = (
      (await (await harness.app.request('/metrics')).json()) as {
        requests: number;
      }
    ).requests;

    expect(after).toBeGreaterThanOrEqual(before + 2);
  });

  it('increments errors counter after a validation failure', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router);

    const before = (
      (await (await harness.app.request('/metrics')).json()) as {
        errors: number;
      }
    ).errors;

    await harness.app.request('/chat', jsonPost({ messages: [] }));

    const after = (
      (await (await harness.app.request('/metrics')).json()) as {
        errors: number;
      }
    ).errors;

    expect(after).toBe(before + 1);
  });
});

// ============================================================
// CONDITIONAL ROUTE REGISTRATION
// ============================================================

describe('Conditional route registration — routes.openai: false', () => {
  it('POST /v1/chat/completions returns Hono default 404 when openai route is disabled', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router, { routes: { openai: false } });

    const res = await harness.app.request('/v1/chat/completions', VALID_BODY);

    expect(res.status).toBe(404);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).not.toContain('application/json');
  });
});

describe('Conditional route registration — routes.perAgent: false', () => {
  it('POST /agents/:name/chat returns Hono default 404 when perAgent route is disabled', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router, { routes: { perAgent: false } });

    const res = await harness.app.request('/agents/alpha/chat', VALID_BODY);

    expect(res.status).toBe(404);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).not.toContain('application/json');
  });
});

describe('Conditional route registration — routes.defaultAgent: false', () => {
  it('POST /chat returns Hono default 404 when defaultAgent route is disabled', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router, {
      routes: { defaultAgent: false },
    });

    const res = await harness.app.request('/chat', VALID_BODY);

    expect(res.status).toBe(404);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).not.toContain('application/json');
  });
});

describe('Conditional route registration — routes.discovery: false', () => {
  it('GET /agents returns Hono default 404 when discovery route is disabled', async () => {
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([
        ['alpha', makeChatHandler({ name: 'alpha' })],
      ]),
      defaultAgent: 'alpha',
    });
    const harness = createChatHarness(router, {
      routes: { discovery: false },
    });

    const res = await harness.app.request('/agents');
    expect(res.status).toBe(404);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).not.toContain('application/json');
  });
});
