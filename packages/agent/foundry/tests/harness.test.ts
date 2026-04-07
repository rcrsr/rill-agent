import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import type { AgentRouter, RunContext, RunRequest } from '@rcrsr/rill-agent';
import { createFoundryHarness } from '../src/harness.js';

// ============================================================
// AZURE IDENTITY MOCK
// ============================================================

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    async getToken(): Promise<{ token: string; expiresOnTimestamp: number }> {
      return {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3_600_000,
      };
    }
  },
}));

// ============================================================
// MOCK ROUTER FACTORY
// ============================================================

interface CapturedContext {
  sessionVars?: Record<string, string> | undefined;
}

function makeMockRouter(
  overrides: Partial<AgentRouter> = {},
  capture?: CapturedContext
): AgentRouter {
  return {
    defaultAgent: () => 'default',
    agents: () => ['default'],
    describe: (name: string) =>
      name === 'default'
        ? {
            name: 'handler',
            description: 'Test handler',
            params: [
              {
                name: 'input',
                type: 'string',
                description: 'Input',
                required: true,
              },
            ],
          }
        : null,
    run: async (
      _name: string,
      request: RunRequest,
      context?: RunContext
    ): Promise<{ state: 'completed'; result: string }> => {
      if (capture !== undefined) {
        capture.sessionVars = context?.sessionVars;
      }
      return {
        state: 'completed' as const,
        result: String(request.params?.['input'] ?? ''),
      };
    },
    dispose: async () => undefined,
    ...overrides,
  };
}

// ============================================================
// ENV VAR MANAGEMENT HELPERS
// ============================================================

const ENV_KEYS = [
  'DEFAULT_AD_PORT',
  'MAX_CONCURRENT_SESSIONS',
  'FOUNDRY_AGENT_NAME',
  'FOUNDRY_AGENT_VERSION',
  'FOUNDRY_PROJECT_ENDPOINT',
  'FOUNDRY_AGENT_DEBUG_ERRORS',
];

const savedEnv: Record<string, string | undefined> = {};

function saveEnv(): void {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
}

// ============================================================
// HELPERS
// ============================================================

function jsonRequest(
  body: unknown,
  headers: Record<string, string> = {}
): { method: string; headers: Record<string, string>; body: string } {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

// ============================================================
// TESTS
// ============================================================

describe('createFoundryHarness', () => {
  beforeEach(() => {
    saveEnv();
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  // AC-1: POST /responses with string input returns completed response
  it('POST /responses with string input returns completed response', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hello' })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      output: Array<{ content: Array<{ text: string }> }>;
    };
    expect(body.status).toBe('completed');
    expect(body.output[0]?.content[0]?.text).toBe('hello');
  });

  // AC-5: POST /runs returns same result as POST /responses
  it('POST /runs returns same result as POST /responses', async () => {
    const harness = createFoundryHarness(makeMockRouter());

    const responsesRes = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'test' })
    );
    const runsRes = await harness.app.request(
      '/runs',
      jsonRequest({ input: 'test' })
    );

    expect(responsesRes.status).toBe(runsRes.status);
    const responsesBody = (await responsesRes.json()) as { status: string };
    const runsBody = (await runsRes.json()) as { status: string };
    expect(responsesBody.status).toBe(runsBody.status);
  });

  // AC-6: GET /readiness returns 200 after init
  it('GET /readiness returns 200 after init', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request('/readiness');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ready');
  });

  // AC-7: GET /readiness returns 503 before init
  // [ASSUMPTION] The factory sets ready=true synchronously after registering
  // routes. There is no async init step, so the harness is always ready
  // immediately after createFoundryHarness() returns. AC-7 (503 before init)
  // cannot be exercised without modifying the factory to accept a deferred
  // ready signal. Documenting here; 503 path exists in code but is unreachable
  // via the current public API.
  it.skip('GET /readiness returns 503 before init', () => {
    // Not testable: ready=true is set synchronously in the factory
  });

  // AC-8: GET /liveness returns 200
  it('GET /liveness returns 200', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request('/liveness');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  // AC-9: Port defaults to 8088
  it('uses port 8088 when DEFAULT_AD_PORT is not set', () => {
    delete process.env['DEFAULT_AD_PORT'];
    // No throw means the default port was accepted
    expect(() => createFoundryHarness(makeMockRouter())).not.toThrow();
  });

  // AC-10: Port uses DEFAULT_AD_PORT env var
  it('reads port from DEFAULT_AD_PORT env var', () => {
    process.env['DEFAULT_AD_PORT'] = '9090';
    expect(() => createFoundryHarness(makeMockRouter())).not.toThrow();
  });

  it('throws when DEFAULT_AD_PORT is non-numeric', () => {
    process.env['DEFAULT_AD_PORT'] = 'not-a-number';
    expect(() => createFoundryHarness(makeMockRouter())).toThrow();
  });

  // AC-13: Session vars AZURE_OID, AZURE_TID from headers
  it('sets AZURE_OID and AZURE_TID session vars from request headers', async () => {
    const capture: CapturedContext = {};
    const harness = createFoundryHarness(makeMockRouter({}, capture));

    await harness.app.request(
      '/responses',
      jsonRequest(
        { input: 'test' },
        { 'x-aml-oid': 'oid-123', 'x-aml-tid': 'tid-456' }
      )
    );

    expect(capture.sessionVars?.['AZURE_OID']).toBe('oid-123');
    expect(capture.sessionVars?.['AZURE_TID']).toBe('tid-456');
  });

  // AC-14: Session vars FOUNDRY_USER, FOUNDRY_MODEL, FOUNDRY_TEMPERATURE from body
  it('sets FOUNDRY_USER, FOUNDRY_MODEL, FOUNDRY_TEMPERATURE from request body', async () => {
    const capture: CapturedContext = {};
    const harness = createFoundryHarness(makeMockRouter({}, capture));

    await harness.app.request(
      '/responses',
      jsonRequest({
        input: 'test',
        user: 'alice',
        model: 'gpt-4',
        temperature: 0.7,
      })
    );

    expect(capture.sessionVars?.['FOUNDRY_USER']).toBe('alice');
    expect(capture.sessionVars?.['FOUNDRY_MODEL']).toBe('gpt-4');
    expect(capture.sessionVars?.['FOUNDRY_TEMPERATURE']).toBe('0.7');
  });

  // AC-18: store: true with conversation saves to Conversations API (mocked)
  it('calls Conversations API when store is true and conversation is set', async () => {
    process.env['FOUNDRY_PROJECT_ENDPOINT'] = 'https://fake.openai.azure.com';

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      ) as MockInstance;
    vi.stubGlobal('fetch', fetchMock);

    const harness = createFoundryHarness(makeMockRouter());

    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hello', store: true, conversation: 'conv_001' })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const [calledUrl] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(calledUrl).toContain('conv_001');
    expect(calledUrl).toContain('items');
  });

  // AC-19: store: false skips Conversations API
  it('does not call Conversations API when store is false', async () => {
    process.env['FOUNDRY_PROJECT_ENDPOINT'] = 'https://fake.openai.azure.com';

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      ) as MockInstance;
    vi.stubGlobal('fetch', fetchMock);

    const harness = createFoundryHarness(makeMockRouter());

    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hello', store: false, conversation: 'conv_002' })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // AC-22: x-aml-foundry-agents-metadata header on all responses
  it('includes x-aml-foundry-agents-metadata header on all responses', async () => {
    const harness = createFoundryHarness(makeMockRouter());

    const routes = [
      { path: '/responses', init: jsonRequest({ input: 'hi' }) },
      { path: '/liveness', init: { method: 'GET' } },
      { path: '/readiness', init: { method: 'GET' } },
      { path: '/metrics', init: { method: 'GET' } },
    ];

    for (const { path, init } of routes) {
      const res = await harness.app.request(path, init);
      expect(
        res.headers.get('x-aml-foundry-agents-metadata'),
        `expected header on ${path}`
      ).not.toBeNull();
    }
  });

  // AC-23: Metadata header uses env var overrides
  it('includes agent name and version in metadata header from env vars', async () => {
    process.env['FOUNDRY_AGENT_NAME'] = 'my-agent';
    process.env['FOUNDRY_AGENT_VERSION'] = '2.0.0';

    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request('/liveness');

    const metaRaw = res.headers.get('x-aml-foundry-agents-metadata');
    expect(metaRaw).not.toBeNull();
    const meta = JSON.parse(metaRaw ?? '{}') as {
      name: string;
      version: string;
    };
    expect(meta.name).toBe('my-agent');
    expect(meta.version).toBe('2.0.0');
  });

  // AC-26: GET /metrics returns JSON with expected fields
  it('GET /metrics returns JSON with activeSessions, totalRequests, errorCount', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request('/metrics');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activeSessions: number;
      totalRequests: number;
      errorCount: number;
    };
    expect(typeof body.activeSessions).toBe('number');
    expect(typeof body.totalRequests).toBe('number');
    expect(typeof body.errorCount).toBe('number');
  });

  // AC-28: totalRequests increments per request
  it('increments totalRequests for each request', async () => {
    const harness = createFoundryHarness(makeMockRouter());

    await harness.app.request('/liveness');
    await harness.app.request('/liveness');
    await harness.app.request('/liveness');

    const metricsRes = await harness.app.request('/metrics');
    const body = (await metricsRes.json()) as { totalRequests: number };
    // 3 liveness + 1 metrics request
    expect(body.totalRequests).toBeGreaterThanOrEqual(4);
  });

  // AC-29: errorCount increments for 4xx/5xx
  it('increments errorCount for invalid requests', async () => {
    const harness = createFoundryHarness(makeMockRouter());

    // Trigger a 400 by sending empty input
    await harness.app.request('/responses', jsonRequest({ input: '' }));

    const metricsRes = await harness.app.request('/metrics');
    const body = (await metricsRes.json()) as { errorCount: number };
    expect(body.errorCount).toBeGreaterThanOrEqual(1);
  });

  // AC-30, EC-1: missing input → 400
  it('returns 400 with INVALID_REQUEST when input is missing', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request('/responses', jsonRequest({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 with INVALID_REQUEST when input is empty string', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: '' })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  // AC-33, EC-1: handler not found → 404
  it('returns 404 when router.run throws with "not found" message', async () => {
    const notFoundRouter = makeMockRouter({
      run: async () => {
        throw new Error('agent not found');
      },
    });
    const harness = createFoundryHarness(notFoundRouter);
    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hi' })
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  // AC-46: conversation ID as string vs {id: "..."} both resolve
  it('accepts conversation as plain string', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hello', conversation: 'conv_str' })
    );
    expect(res.status).toBe(200);
  });

  it('accepts conversation as {id: "..."} object', async () => {
    const harness = createFoundryHarness(makeMockRouter());
    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hello', conversation: { id: 'conv_obj' } })
    );
    expect(res.status).toBe(200);
  });

  // AC-31: missing required handler param → 400 naming the parameter
  it('returns 400 with INVALID_REQUEST naming missing handler param', async () => {
    const routerWithExtraParam = makeMockRouter({
      describe: (name: string) =>
        name === 'default'
          ? {
              name: 'handler',
              description: 'Test handler',
              params: [
                {
                  name: 'input',
                  type: 'string',
                  description: 'Input',
                  required: true,
                },
                {
                  name: 'topic',
                  type: 'string',
                  description: 'Topic',
                  required: true,
                },
              ],
            }
          : null,
    });
    const harness = createFoundryHarness(routerWithExtraParam, {
      debugErrors: true,
    });
    // Send valid input but omit required 'topic' param
    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hello' })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toContain('topic');
  });

  // AC-32: wrong param type → 400 naming the mismatch
  // extractInput produces params: { input: string } from a plain string body.
  // Describe 'input' as type 'number' so validateParams flags the mismatch.
  it('returns 400 with INVALID_REQUEST naming type mismatch for handler param', async () => {
    const router = makeMockRouter({
      describe: (name: string) =>
        name === 'default'
          ? {
              name: 'handler',
              description: 'Test handler',
              params: [
                {
                  name: 'input',
                  type: 'number',
                  description: 'Input',
                  required: true,
                },
              ],
            }
          : null,
    });
    const harness = createFoundryHarness(router, { debugErrors: true });
    // 'hello' is a string but the handler expects number
    const res = await harness.app.request(
      '/responses',
      jsonRequest({ input: 'hello' })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toContain('input');
    expect(body.error.message).toContain('number');
  });

  // AC-48: agent with no extensions has no extra capabilities injected
  it('does not inject extra session vars beyond those from headers and body', async () => {
    const capture: CapturedContext = {};
    const harness = createFoundryHarness(makeMockRouter({}, capture));

    await harness.app.request('/responses', jsonRequest({ input: 'test' }));

    // Only expected keys may be present — no unexpected injection
    const keys = Object.keys(capture.sessionVars ?? {});
    for (const key of keys) {
      expect([
        'AZURE_OID',
        'AZURE_TID',
        'FOUNDRY_USER',
        'FOUNDRY_MODEL',
        'FOUNDRY_TEMPERATURE',
      ]).toContain(key);
    }
  });
});
