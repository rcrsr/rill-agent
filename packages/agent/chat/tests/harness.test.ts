import { describe, it, expect, afterEach } from 'vitest';
import type { AgentHandler, AgentRouter, RunContext } from '@rcrsr/rill-agent';
import { createChatHarness, ChatSignatureError } from '../src/index.js';
import {
  jsonPost,
  makeChatHandler,
  makeRouter,
  makeRpcHandler,
  vi,
  VALID_MESSAGES,
} from './_fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// FACTORY CONSTRUCTION
// ============================================================

describe('createChatHarness — factory construction', () => {
  it('returns a ChatHarness synchronously when router has a chat-eligible agent', async () => {
    const router = await makeRouter({
      agents: new Map([['solo', makeChatHandler({ name: 'solo' })]]),
      defaultAgent: 'solo',
    });
    const harness = createChatHarness(router);
    expect(harness).toBeDefined();
    expect(typeof harness.listen).toBe('function');
    expect(typeof harness.close).toBe('function');
    expect(harness.app).toBeDefined();
  });

  it('throws TypeError with message "router is required" when null is passed', () => {
    expect(() => createChatHarness(null as unknown as AgentRouter)).toThrow(
      TypeError
    );
    expect(() => createChatHarness(null as unknown as AgentRouter)).toThrow(
      'router is required'
    );
  });

  it('throws ChatSignatureError when the default agent has an incompatible signature', async () => {
    const router = await makeRouter({
      agents: new Map([['rpc', makeRpcHandler('rpc')]]),
      defaultAgent: 'rpc',
    });
    expect(() => createChatHarness(router)).toThrow(ChatSignatureError);
    expect(() => createChatHarness(router)).toThrow('rpc');
  });

  it('ChatSignatureError surfaces the eligibility rejection reason', async () => {
    const router = await makeRouter({
      agents: new Map([['my-agent', makeRpcHandler('my-agent')]]),
      defaultAgent: 'my-agent',
    });
    let caught: unknown;
    try {
      createChatHarness(router);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChatSignatureError);
    expect((caught as Error).message).toContain('my-agent');
    expect((caught as Error).message).toContain('exactly one param');
  });

  it('factory succeeds with no agents when all routes are disabled', async () => {
    const router = await makeRouter({
      agents: new Map(),
      defaultAgent: '',
    });
    expect(() =>
      createChatHarness(router, {
        routes: {
          openai: false,
          perAgent: false,
          defaultAgent: false,
          discovery: false,
        },
      })
    ).not.toThrow();
  });

  it('factory succeeds when all agents are ineligible with defaultAgent route disabled', async () => {
    const router = await makeRouter({
      agents: new Map([['rpc', makeRpcHandler()]]),
      defaultAgent: 'rpc',
    });
    expect(() =>
      createChatHarness(router, {
        routes: { defaultAgent: false, perAgent: false },
      })
    ).not.toThrow();
  });
});

// ============================================================
// DEFAULT ROUTE FLAGS
// ============================================================

describe('createChatHarness — default route flags', () => {
  it('registers all four routes when options is omitted', async () => {
    const router = await makeRouter({
      agents: new Map([['agent1', makeChatHandler({ name: 'agent1' })]]),
      defaultAgent: 'agent1',
    });
    const harness = createChatHarness(router);

    // GET /agents — discovery route should be registered (returns 200)
    const agentsRes = await harness.app.request('/agents');
    expect(agentsRes.status).toBe(200);

    // POST /v1/chat/completions — openai route registered; bad body → 400 not 404
    const openaiRes = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ messages: [] })
    );
    expect(openaiRes.status).not.toBe(404);

    // POST /agents/:name/chat — perAgent route registered; bad body → 400 not 404
    const perAgentRes = await harness.app.request(
      '/agents/agent1/chat',
      jsonPost({ messages: [] })
    );
    expect(perAgentRes.status).not.toBe(404);

    // POST /chat — defaultAgent route registered; bad body → 400 not 404
    const chatRes = await harness.app.request(
      '/chat',
      jsonPost({ messages: [] })
    );
    expect(chatRes.status).not.toBe(404);
  });

  it('GET /agents returns 404 when discovery route is disabled', async () => {
    const router = await makeRouter({
      agents: new Map(),
      defaultAgent: '',
    });
    const harness = createChatHarness(router, {
      routes: {
        openai: false,
        perAgent: false,
        defaultAgent: false,
        discovery: false,
      },
    });
    const res = await harness.app.request('/agents');
    expect(res.status).toBe(404);
  });
});

// ============================================================
// HANDLER INVOCATION
// ============================================================

describe('createChatHarness — handler invocation contract', () => {
  it('calls handler.execute() with messages in request.params', async () => {
    let captured: { request: unknown; context: RunContext } | undefined;
    const handler = makeChatHandler({
      name: 'agent',
      onInvoke: (request, context) => {
        captured = { request, context };
      },
    });
    const router = await makeRouter({
      agents: new Map([['agent', handler]]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);

    await harness.app.request(
      '/agents/agent/chat',
      jsonPost({ messages: VALID_MESSAGES })
    );

    expect(captured).toBeDefined();
    expect(
      (captured!.request as { params?: { messages?: unknown[] } }).params
        ?.messages
    ).toEqual(VALID_MESSAGES);
  });

  it('passes an onChunk callback in the RunContext', async () => {
    let captured: RunContext | undefined;
    const handler = makeChatHandler({
      onInvoke: (_request, context) => {
        captured = context;
      },
    });
    const router = await makeRouter({
      agents: new Map([['agent', handler]]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);

    await harness.app.request(
      '/agents/agent/chat',
      jsonPost({ messages: VALID_MESSAGES })
    );

    expect(captured).toBeDefined();
    expect(typeof captured!.onChunk).toBe('function');
  });
});

// ============================================================
// SIGNATURE INSPECTION RUNS ONCE
// ============================================================

describe('createChatHarness — one-time signature inspection', () => {
  it('inspects each handler exactly once at factory time, not per request', async () => {
    let describeCallCount = 0;
    const handler = makeChatHandler({ name: 'agent' });
    const originalDescribe = handler.describe.bind(handler);
    handler.describe = () => {
      describeCallCount++;
      return originalDescribe();
    };

    const router = await makeRouter({
      agents: new Map([['agent', handler]]),
      defaultAgent: 'agent',
    });

    // createRouter calls describe() once during construction to populate
    // the descriptions map; the chat harness adds one more call during
    // eligibility inspection.
    const callsAfterRouter = describeCallCount;
    const harness = createChatHarness(router);
    const callsAfterHarness = describeCallCount;
    expect(callsAfterHarness - callsAfterRouter).toBe(1);

    // Each subsequent request must not trigger another describe() call —
    // eligibility is cached at construction time.
    await harness.app.request(
      '/agents/agent/chat',
      jsonPost({ messages: VALID_MESSAGES })
    );
    await harness.app.request(
      '/agents/agent/chat',
      jsonPost({ messages: VALID_MESSAGES })
    );
    await harness.app.request(
      '/agents/agent/chat',
      jsonPost({ messages: VALID_MESSAGES })
    );

    expect(describeCallCount).toBe(callsAfterHarness);
  });
});

// ============================================================
// BOUNDARY CASES
// ============================================================

describe('createChatHarness — BC: empty agents + all routes disabled', () => {
  it('GET /agents returns 404 when discovery route is disabled', async () => {
    const router = await makeRouter({
      agents: new Map(),
      defaultAgent: '',
    });
    const harness = createChatHarness(router, {
      routes: {
        openai: false,
        perAgent: false,
        defaultAgent: false,
        discovery: false,
      },
    });

    const res = await harness.app.request('/agents');
    expect(res.status).toBe(404);
  });
});

describe('createChatHarness — BC: single agent as default and only chat-eligible', () => {
  it('GET /agents returns entry with default:true', async () => {
    const router = await makeRouter({
      agents: new Map([['solo', makeChatHandler({ name: 'solo' })]]),
      defaultAgent: 'solo',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request('/agents');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{ name: string; default: boolean }>;
    };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]!.name).toBe('solo');
    expect(body.agents[0]!.default).toBe(true);
  });

  it('POST /agents/:name/chat streams a response', async () => {
    const router = await makeRouter({
      agents: new Map([['solo', makeChatHandler({ name: 'solo' })]]),
      defaultAgent: 'solo',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/agents/solo/chat',
      jsonPost({ messages: VALID_MESSAGES, stream: true })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('POST /chat streams a response', async () => {
    const router = await makeRouter({
      agents: new Map([['solo', makeChatHandler({ name: 'solo' })]]),
      defaultAgent: 'solo',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/chat',
      jsonPost({ messages: VALID_MESSAGES, stream: true })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('POST /v1/chat/completions streams a response', async () => {
    const router = await makeRouter({
      agents: new Map([['solo', makeChatHandler({ name: 'solo' })]]),
      defaultAgent: 'solo',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ messages: VALID_MESSAGES, model: 'solo', stream: true })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });
});

describe('createChatHarness — BC: all agents ineligible with routes disabled', () => {
  it('GET /agents returns empty agents array', async () => {
    const router = await makeRouter({
      agents: new Map([
        ['rpc1', makeRpcHandler('rpc1')],
        ['rpc2', makeRpcHandler('rpc2')],
      ]),
      defaultAgent: 'rpc1',
    });
    const harness = createChatHarness(router, {
      routes: { defaultAgent: false, perAgent: false },
    });

    const res = await harness.app.request('/agents');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: unknown[] };
    expect(body.agents).toHaveLength(0);
  });

  it('POST /v1/chat/completions returns 404 when openai route is disabled', async () => {
    const router = await makeRouter({
      agents: new Map([['rpc', makeRpcHandler()]]),
      defaultAgent: 'rpc',
    });
    const harness = createChatHarness(router, {
      routes: { openai: false, defaultAgent: false, perAgent: false },
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ messages: VALID_MESSAGES })
    );
    expect(res.status).toBe(404);
  });
});

// ============================================================
// LIFECYCLE
// ============================================================

describe('createChatHarness — lifecycle', () => {
  it('close() before listen() resolves without throwing', async () => {
    const router = await makeRouter({
      agents: new Map([['agent', makeChatHandler({ name: 'agent' })]]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);
    await expect(harness.close()).resolves.toBeUndefined();
  });

  it('second listen() while server is running throws "Server is already listening"', async () => {
    const router = await makeRouter({
      agents: new Map([['agent', makeChatHandler({ name: 'agent' })]]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);

    await harness.listen(0);
    try {
      await expect(harness.listen(0)).rejects.toThrow(
        'Server is already listening'
      );
    } finally {
      await harness.close();
    }
  });

  // Port-bind failure propagation is not exercised here: ESM module namespaces
  // are not configurable, so vi.spyOn cannot replace the `serve` export from
  // @hono/node-server at test time.
});

// ============================================================
// VALID JSON BUT UNREGISTERED BODY
// ============================================================

describe('createChatHarness — request validation', () => {
  it('POST /agents/:name/chat returns 400 for empty messages array', async () => {
    const router = await makeRouter({
      agents: new Map([['agent', makeChatHandler({ name: 'agent' })]]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/agents/agent/chat',
      jsonPost({ messages: [] })
    );
    expect(res.status).toBe(400);
  });

  it('POST /agents/:name/chat returns 404 for unknown agent', async () => {
    const router = await makeRouter({
      agents: new Map([['agent', makeChatHandler({ name: 'agent' })]]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/agents/unknown/chat',
      jsonPost({ messages: VALID_MESSAGES })
    );
    expect(res.status).toBe(404);
  });

  it('POST /v1/chat/completions returns 400 for missing messages', async () => {
    const router = await makeRouter({
      agents: new Map([['agent', makeChatHandler({ name: 'agent' })]]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ model: 'agent' })
    );
    expect(res.status).toBe(400);
  });

  it('POST /agents/:name/chat returns a reason-bearing 403 for a known but chat-ineligible agent', async () => {
    const router = await makeRouter({
      agents: new Map([
        ['agent', makeChatHandler({ name: 'agent' })],
        ['rpc', makeRpcHandler('rpc')],
      ]),
      defaultAgent: 'agent',
    });
    const harness = createChatHarness(router);

    const res = await harness.app.request(
      '/agents/rpc/chat',
      jsonPost({ messages: VALID_MESSAGES })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('rpc');
  });
});

// ============================================================
// CLIENT DISCONNECT — BUFFERED PATH ABORTS HANDLER
// ============================================================

describe('createChatHarness — buffered path aborts on client disconnect', () => {
  it('propagates request signal abort to the handler-visible RunContext.signal', async () => {
    let captured: RunContext | undefined;
    let executeStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      executeStarted = resolve;
    });
    let releaseHang: (() => void) | undefined;
    const hang = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });

    const handler: AgentHandler = {
      describe() {
        return {
          name: 't',
          params: [
            {
              name: 'messages',
              type: 'list(dict(role: string, content: string))',
              required: true,
            },
          ],
          returnType:
            'stream(dict(choices: list(dict(delta: dict(role: string, content: string), finish_reason: string)))):string',
        };
      },
      async init() {},
      async execute(_request, context?: RunContext) {
        captured = context;
        executeStarted?.();
        await hang;
        return { state: 'completed', result: null, streamed: false };
      },
      async dispose() {},
    };
    const router = await makeRouter({
      agents: new Map<string, AgentHandler>([['t', handler]]),
      defaultAgent: 't',
    });
    const harness = createChatHarness(router);

    const controller = new AbortController();
    const resPromise = harness.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 't',
        messages: VALID_MESSAGES,
        stream: false,
      }),
      signal: controller.signal,
    });

    await started;
    expect(captured?.signal?.aborted).toBe(false);

    controller.abort();
    releaseHang?.();
    await resPromise.catch(() => {
      // The abort may surface as a rejected fetch on some environments;
      // the assertion of interest is the handler-visible signal below.
    });

    expect(captured?.signal?.aborted).toBe(true);
  });
});
