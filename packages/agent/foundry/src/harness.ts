import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { DefaultAzureCredential } from '@azure/identity';
import type { AgentRouter, RunContext, RunRequest } from '@rcrsr/rill-agent';
import type {
  CreateResponse,
  FoundryHarnessOptions,
  FoundryMetrics,
} from './types.js';
import { CapacityError, CredentialError, InputError } from './errors.js';
import { extractInput } from './extract.js';
import { generateId } from './id.js';
import { buildErrorResponse, buildSyncResponse } from './response.js';
import { createSessionManager } from './session.js';
import { streamFoundryResponse } from './stream.js';
import {
  createConversationsClient,
  PersistenceError,
} from './conversations.js';

// ============================================================
// TYPES
// ============================================================

export interface FoundryHarness {
  listen(): Promise<void>;
  close(): Promise<void>;
  readonly app: Hono;
  metrics(): FoundryMetrics;
}

// ============================================================
// PARAM VALIDATION
// ============================================================

/**
 * Validate extracted params against the handler description for a named agent.
 * Returns a string describing the first violation, or null when valid.
 * Returns null when describe() returns null (no description available).
 */
function validateParams(
  params: Record<string, unknown>,
  agentName: string,
  router: AgentRouter
): string | null {
  const desc = router.describe(agentName);
  if (desc === null) return null;

  for (const param of desc.params) {
    const value = params[param.name];
    if (param.required && (value === undefined || value === null)) {
      return `Missing required parameter: ${param.name}`;
    }
    if (value !== undefined && value !== null && param.type !== 'any') {
      const actual = typeof value;
      const expected = param.type === 'dict' ? 'object' : param.type;
      if (expected === 'list') {
        if (!Array.isArray(value)) {
          return `Parameter "${param.name}" must be a list, got ${actual}`;
        }
      } else if (expected === 'object') {
        if (actual !== 'object' || value === null || Array.isArray(value)) {
          return `Parameter "${param.name}" must be a dict, got ${Array.isArray(value) ? 'list' : actual}`;
        }
      } else if (actual !== expected) {
        return `Parameter "${param.name}" must be ${param.type}, got ${actual}`;
      }
    }
  }

  return null;
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_PORT = 8088;

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve the port from options or DEFAULT_AD_PORT env var.
 * Throws when the env var value is non-numeric.
 */
function resolvePort(options?: FoundryHarnessOptions): number {
  if (options?.port !== undefined) {
    if (!Number.isFinite(options.port)) {
      throw new Error(`Invalid port: "${options.port}"`);
    }
    return options.port;
  }
  const envVal = process.env['DEFAULT_AD_PORT'];
  if (envVal === undefined) {
    return DEFAULT_PORT;
  }
  const parsed = Number(envVal);
  if (!Number.isFinite(parsed) || envVal.trim() === '') {
    throw new Error(`Invalid port: "${envVal}"`);
  }
  return parsed;
}

/**
 * Resolve the conversationId from the request body field.
 * Accepts string or {id: string} object per AC-46.
 */
function resolveConversationId(
  conversation: CreateResponse['conversation']
): string | undefined {
  if (conversation === undefined) {
    return undefined;
  }
  if (typeof conversation === 'string') {
    return conversation;
  }
  return conversation.id;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a Foundry harness wrapping an AgentRouter.
 *
 * Routes:
 *   POST /responses  — main Foundry Responses endpoint
 *   POST /runs       — alias for /responses (AC-5)
 *   GET  /readiness  — 503 before init, 200 after (AC-6, AC-7)
 *   GET  /liveness   — always 200 (AC-8)
 *   GET  /metrics    — FoundryMetrics JSON (AC-26)
 *
 * Throws synchronously when the port configuration is invalid (EC-2).
 */
export function createFoundryHarness(
  router: AgentRouter,
  options?: FoundryHarnessOptions
): FoundryHarness {
  const port = resolvePort(options);
  const debugErrors =
    options?.debugErrors ??
    process.env['FOUNDRY_AGENT_DEBUG_ERRORS'] === 'true';
  const agentName = options?.agentName ?? process.env['FOUNDRY_AGENT_NAME'];
  const agentVersion =
    options?.agentVersion ?? process.env['FOUNDRY_AGENT_VERSION'];

  const sessions = createSessionManager();

  const projectEndpoint = process.env['FOUNDRY_PROJECT_ENDPOINT'];
  const azureCredential =
    projectEndpoint !== undefined ? new DefaultAzureCredential() : undefined;
  const conversationsClient =
    projectEndpoint !== undefined && azureCredential !== undefined
      ? createConversationsClient(projectEndpoint, azureCredential)
      : undefined;

  let totalRequests = 0;
  let errorCount = 0;
  let server: ServerType | undefined;
  let ready = false;

  const app = new Hono();

  // ============================================================
  // MIDDLEWARE — agent metadata header
  // ============================================================

  app.use('*', async (c, next) => {
    await next();
    const meta: Record<string, string> = {};
    if (agentName !== undefined) meta['name'] = agentName;
    if (agentVersion !== undefined) meta['version'] = agentVersion;
    c.res.headers.set('x-aml-foundry-agents-metadata', JSON.stringify(meta));
  });

  // ============================================================
  // PROBE ROUTES
  // ============================================================

  app.get('/liveness', (c) => {
    totalRequests++;
    return c.json({ status: 'ok' }, 200);
  });

  app.get('/readiness', (c) => {
    totalRequests++;
    if (!ready) {
      errorCount++;
      return c.json({ status: 'initializing' }, 503);
    }
    return c.json({ status: 'ready' }, 200);
  });

  app.get('/metrics', (c) => {
    totalRequests++;
    return c.json({
      activeSessions: sessions.activeCount(),
      totalRequests,
      errorCount,
    });
  });

  // ============================================================
  // RESPONSE HANDLER
  // ============================================================

  async function handleResponseRequest(c: Context): Promise<Response> {
    totalRequests++;

    // Parse body
    let body: CreateResponse;
    try {
      const parsed: unknown = await c.req.json();
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        errorCount++;
        return c.json(
          buildErrorResponse(
            'INVALID_REQUEST',
            'Request body must be a JSON object',
            debugErrors
          ),
          400
        );
      }
      body = parsed as CreateResponse;
    } catch {
      errorCount++;
      return c.json(
        buildErrorResponse(
          'INVALID_REQUEST',
          'Invalid JSON in request body',
          debugErrors
        ),
        400
      );
    }

    // Extract input
    let extracted: ReturnType<typeof extractInput>;
    try {
      extracted = extractInput(body.input);
    } catch (err) {
      errorCount++;
      if (err instanceof InputError) {
        return c.json(
          buildErrorResponse('INVALID_REQUEST', err.message, debugErrors),
          400
        );
      }
      return c.json(
        buildErrorResponse(
          'SERVER_ERROR',
          err instanceof Error ? err.message : String(err),
          debugErrors
        ),
        500
      );
    }

    // Resolve conversation ID
    const conversationId = resolveConversationId(body.conversation);

    // Resolve agent name early so validation can use it
    const agentName_ = extracted.targetAgent ?? router.defaultAgent();

    // Validate params against handler description (AC-31, AC-32)
    const validationError = validateParams(
      extracted.params,
      agentName_,
      router
    );
    if (validationError !== null) {
      errorCount++;
      return c.json(
        buildErrorResponse('INVALID_REQUEST', validationError, debugErrors),
        400
      );
    }

    // Acquire session
    let sessionId: string;
    try {
      sessionId = sessions.acquire(conversationId);
    } catch (err) {
      errorCount++;
      if (err instanceof CapacityError) {
        return c.json(
          buildErrorResponse('RATE_LIMITED', err.message, debugErrors),
          429
        );
      }
      return c.json(
        buildErrorResponse(
          'SERVER_ERROR',
          err instanceof Error ? err.message : String(err),
          debugErrors
        ),
        500
      );
    }

    const responseId = generateId('resp_');

    // Build session vars from headers + body fields (AC-13, AC-14)
    const sessionVars: Record<string, string> = {};
    const oid = c.req.header('x-aml-oid');
    if (oid !== undefined) sessionVars['AZURE_OID'] = oid;
    const tid = c.req.header('x-aml-tid');
    if (tid !== undefined) sessionVars['AZURE_TID'] = tid;
    if (typeof body.user === 'string') sessionVars['FOUNDRY_USER'] = body.user;
    if (typeof body.model === 'string')
      sessionVars['FOUNDRY_MODEL'] = body.model;
    if (typeof body.temperature === 'number')
      sessionVars['FOUNDRY_TEMPERATURE'] = String(body.temperature);

    const runContext: RunContext = {
      sessionVars,
    };

    const runRequest: RunRequest = {
      params: extracted.params,
    };

    // Streaming path
    if (body.stream === true) {
      // For streaming we need an async iterable that yields chunks.
      // router.run() is not natively streaming, so we wrap the single
      // result as a one-element iterable.
      async function* makeStream(): AsyncIterable<{ value?: unknown }> {
        try {
          const result = await router.run(agentName_, runRequest, runContext);
          yield { value: result.result };
        } finally {
          sessions.release(sessionId);
        }
      }

      return streamFoundryResponse(c, responseId, makeStream(), {
        onError: (_err) => {
          errorCount++;
        },
      });
    }

    // Synchronous path
    try {
      let result: Awaited<ReturnType<typeof router.run>>;
      try {
        result = await router.run(agentName_, runRequest, runContext);
      } catch (err) {
        errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) {
          return c.json(buildErrorResponse('NOT_FOUND', msg, debugErrors), 404);
        }
        return c.json(
          buildErrorResponse('SERVER_ERROR', msg, debugErrors),
          500
        );
      }

      const response = buildSyncResponse(result, responseId);

      // Conversations persistence (AC-18, AC-19)
      // store defaults to true per spec
      const shouldStore = body.store !== false;
      if (
        shouldStore &&
        conversationId !== undefined &&
        conversationsClient !== undefined
      ) {
        try {
          await conversationsClient.saveItems(conversationId, response.output);
        } catch (err) {
          errorCount++;
          if (err instanceof PersistenceError) {
            return c.json(
              buildErrorResponse('SERVER_ERROR', err.message, debugErrors),
              502
            );
          }
          return c.json(
            buildErrorResponse(
              'SERVER_ERROR',
              err instanceof Error ? err.message : String(err),
              debugErrors
            ),
            502
          );
        }
      }

      if (result.state === 'error') {
        errorCount++;
      }

      return c.json(response, 200);
    } finally {
      sessions.release(sessionId);
    }
  }

  app.post('/responses', (c) => handleResponseRequest(c));
  app.post('/runs', (c) => handleResponseRequest(c));

  // Mark router as ready after routes are registered
  ready = true;

  // ============================================================
  // LIFECYCLE
  // ============================================================

  async function listen(): Promise<void> {
    if (azureCredential !== undefined) {
      try {
        const token = await azureCredential.getToken(
          'https://ai.azure.com/.default'
        );
        if (token === null) {
          throw new CredentialError(
            'Failed to acquire token for scope https://ai.azure.com/.default'
          );
        }
      } catch (err) {
        if (!(err instanceof CredentialError)) {
          const message = err instanceof Error ? err.message : String(err);
          throw new CredentialError(message);
        }
        process.exit(1);
      }
    }
    return new Promise((resolve) => {
      server = serve({ fetch: app.fetch, port }, () => {
        resolve();
      });
    });
  }

  async function close(): Promise<void> {
    if (server !== undefined) {
      server.close();
      server = undefined;
    }
  }

  function metrics(): FoundryMetrics {
    return {
      activeSessions: sessions.activeCount(),
      totalRequests,
      errorCount,
    };
  }

  return { listen, close, app, metrics };
}
