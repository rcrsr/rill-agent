import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentRouter } from '@rcrsr/rill-agent';
import { DefaultAzureCredential } from '@azure/identity';
import { createFoundryHarness } from '../src/harness.js';
import {
  createConversationsClient,
  PersistenceError,
} from '../src/conversations.js';
import { CredentialError } from '../src/errors.js';

// ============================================================
// MOCK AZURE IDENTITY
// ============================================================

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    async getToken() {
      return {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3_600_000,
      };
    }
  },
}));

// ============================================================
// ENV SAVE/RESTORE
// ============================================================

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv['DEFAULT_AD_PORT'] = process.env['DEFAULT_AD_PORT'];
  savedEnv['FOUNDRY_PROJECT_ENDPOINT'] =
    process.env['FOUNDRY_PROJECT_ENDPOINT'];
  // Ensure no side-effects from project endpoint in harness tests
  delete process.env['FOUNDRY_PROJECT_ENDPOINT'];
});

afterEach(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  vi.restoreAllMocks();
});

// ============================================================
// MOCK ROUTER
// ============================================================

const mockRouter: AgentRouter = {
  defaultAgent: () => 'default',
  agents: () => ['default'],
  describe: () => ({ name: 'handler', description: 'Test', params: [] }),
  run: async () => ({ state: 'completed' as const, result: 'ok' }),
  dispose: async () => undefined,
};

// ============================================================
// PORT VALIDATION TESTS  [AC-37, EC-2]
// ============================================================

describe('createFoundryHarness — port validation', () => {
  it('throws when port option is NaN', () => {
    expect(() => createFoundryHarness(mockRouter, { port: NaN })).toThrow(
      'Invalid port: "NaN"'
    );
  });

  it('throws when DEFAULT_AD_PORT env var is non-numeric', () => {
    process.env['DEFAULT_AD_PORT'] = 'abc';
    expect(() => createFoundryHarness(mockRouter)).toThrow(
      'Invalid port: "abc"'
    );
  });

  it('throws when DEFAULT_AD_PORT env var is Infinity', () => {
    process.env['DEFAULT_AD_PORT'] = 'Infinity';
    expect(() => createFoundryHarness(mockRouter)).toThrow(
      'Invalid port: "Infinity"'
    );
  });
});

// ============================================================
// MISSING RILL-CONFIG  [AC-38]
// ============================================================

describe('createFoundryHarness — rill-config loading', () => {
  // [SPEC] AC-38 targets the CLI startup layer, not the harness factory.
  // The harness factory receives a pre-built AgentRouter — it never loads
  // rill-config.json directly. The missing-config exit behavior belongs to
  // the CLI runner that constructs the router before calling createFoundryHarness().
  it.skip('AC-38: missing rill-config exits non-zero with path — tested at CLI layer, not harness factory', () => {
    // No-op: this AC applies to the CLI startup path.
  });
});

// ============================================================
// CONVERSATIONS API FAILURE  [AC-39, EC-7]
// ============================================================

describe('createConversationsClient — API failure', () => {
  it('throws PersistenceError when API returns 500 [AC-39, EC-7]', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 500 }));

    const mockCredential = {
      getToken: async () => ({
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3_600_000,
      }),
    };

    const client = createConversationsClient(
      'https://example.foundry.azure.com',
      mockCredential
    );

    await expect(client.saveItems('conv-1', ['item'])).rejects.toThrow(
      PersistenceError
    );
    await expect(client.saveItems('conv-1', ['item'])).rejects.toThrow(
      'Conversations API error: 500'
    );

    fetchSpy.mockRestore();
  });

  it('includes status code in PersistenceError message [AC-39]', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 403 }));

    const mockCredential = {
      getToken: async () => ({
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3_600_000,
      }),
    };

    const client = createConversationsClient(
      'https://example.foundry.azure.com',
      mockCredential
    );

    await expect(client.saveItems('conv-1', ['item'])).rejects.toThrow(
      'Conversations API error: 403'
    );

    fetchSpy.mockRestore();
  });
});

// ============================================================
// MANAGED IDENTITY FAILURE  [AC-40, EC-6]
// ============================================================

describe('createConversationsClient — managed identity failure', () => {
  it('throws CredentialError when credential.getToken() throws [AC-40, EC-6]', async () => {
    const failingCredential = {
      getToken: async () => {
        throw new Error('Managed identity unavailable');
      },
    };

    const client = createConversationsClient(
      'https://example.foundry.azure.com',
      failingCredential
    );

    await expect(client.saveItems('conv-1', ['item'])).rejects.toThrow(
      CredentialError
    );
    await expect(client.saveItems('conv-1', ['item'])).rejects.toThrow(
      'Managed identity unavailable'
    );
  });

  it('throws CredentialError when credential.getToken() returns null [AC-40]', async () => {
    const nullCredential = {
      getToken: async () => null,
    };

    const client = createConversationsClient(
      'https://example.foundry.azure.com',
      nullCredential
    );

    await expect(client.saveItems('conv-1', ['item'])).rejects.toThrow(
      CredentialError
    );
  });
});

// ============================================================
// HANDLER EXECUTION FAILURE  [AC-34]
// ============================================================

describe('createFoundryHarness — handler execution failure', () => {
  it('returns 500 with SERVER_ERROR body when router.run() throws [AC-34]', async () => {
    const throwingRouter: AgentRouter = {
      ...mockRouter,
      run: async () => {
        throw new Error('unexpected handler failure');
      },
    };

    const harness = createFoundryHarness(throwingRouter, {
      port: 18088,
      debugErrors: true,
    });

    const response = await harness.app.fetch(
      new Request('http://localhost/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'hello' }),
      })
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('SERVER_ERROR');
    expect(body.error.message).toContain('unexpected handler failure');
  });

  it('returns generic message when debugErrors is false [AC-34]', async () => {
    const throwingRouter: AgentRouter = {
      ...mockRouter,
      run: async () => {
        throw new Error('sensitive internal detail');
      },
    };

    const harness = createFoundryHarness(throwingRouter, {
      port: 18089,
      debugErrors: false,
    });

    const response = await harness.app.fetch(
      new Request('http://localhost/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'hello' }),
      })
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('SERVER_ERROR');
    expect(body.error.message).not.toContain('sensitive internal detail');
    expect(body.error.message).toBe('Internal server error');
  });

  it('emits event: error over SSE when router.run() throws with stream: true [AC-34]', async () => {
    const throwingRouter: AgentRouter = {
      ...mockRouter,
      run: async () => {
        throw new Error('streaming handler failure');
      },
    };

    const harness = createFoundryHarness(throwingRouter, {
      port: 18091,
      debugErrors: true,
    });

    const response = await harness.app.fetch(
      new Request('http://localhost/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'hello', stream: true }),
      })
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('event: error');
    expect(text).toContain('"code":"SERVER_ERROR"');
    expect(text).toContain('streaming handler failure');
  });

  it('redacts SSE error message when debugErrors is false and router.run() throws with stream: true', async () => {
    const throwingRouter: AgentRouter = {
      ...mockRouter,
      run: async () => {
        throw new Error('sensitive internal stream detail');
      },
    };

    const harness = createFoundryHarness(throwingRouter, {
      port: 18092,
      debugErrors: false,
    });

    const response = await harness.app.fetch(
      new Request('http://localhost/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'hello', stream: true }),
      })
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('event: error');
    expect(text).toContain('"code":"SERVER_ERROR"');
    expect(text).not.toContain('sensitive internal stream detail');
    expect(text).toContain('Internal server error');
  });
});

// ============================================================
// STARTUP CREDENTIAL CHECK  [AC-40, EC-6]
// ============================================================

describe('createFoundryHarness — startup credential check', () => {
  it('calls process.exit(1) on listen() when managed identity returns null token [AC-40, EC-6]', async () => {
    process.env['FOUNDRY_PROJECT_ENDPOINT'] =
      'https://example.foundry.azure.com';

    // Override the mocked DefaultAzureCredential prototype to return null
    vi.spyOn(DefaultAzureCredential.prototype, 'getToken').mockResolvedValue(
      null
    );

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: string | number | null | undefined) => {
        throw new Error('process.exit called');
      });

    const harness = createFoundryHarness(mockRouter, { port: 18092 });

    await expect(harness.listen()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('throws CredentialError on listen() when managed identity getToken() throws [AC-40, EC-6]', async () => {
    process.env['FOUNDRY_PROJECT_ENDPOINT'] =
      'https://example.foundry.azure.com';

    vi.spyOn(DefaultAzureCredential.prototype, 'getToken').mockRejectedValue(
      new Error('Managed identity unavailable')
    );

    const harness = createFoundryHarness(mockRouter, { port: 18093 });

    await expect(harness.listen()).rejects.toThrow(CredentialError);
    await expect(
      createFoundryHarness(mockRouter, { port: 18094 }).listen()
    ).rejects.toThrow('Managed identity unavailable');
  });
});

// ============================================================
// READINESS PROBE LATENCY  [AC-47]
// ============================================================

describe('createFoundryHarness — readiness probe', () => {
  it('responds to GET /readiness within 100ms after factory returns [AC-47]', async () => {
    const harness = createFoundryHarness(mockRouter, { port: 18090 });

    const start = Date.now();
    const response = await harness.app.fetch(
      new Request('http://localhost/readiness')
    );
    const elapsed = Date.now() - start;

    // ready flag is set synchronously in the factory, so 200 is immediate
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });
});
