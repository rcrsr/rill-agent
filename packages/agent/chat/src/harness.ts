import type { Context } from 'hono';
import { cors } from 'hono/cors';
import {
  assertJsonObject,
  createHarnessLifecycle,
} from '@rcrsr/rill-agent-hono-kit';
import type { AgentHandler, AgentRouter } from '@rcrsr/rill-agent';
import { ChatSignatureError } from './errors.js';
import { inspectChatHandler } from './eligibility.js';
import { createChatStreamResponse } from './stream.js';
import { validateMessages } from './validate.js';
import type {
  AhiResolver,
  ChatChunk,
  ChatHarness,
  ChatHarnessOptions,
  ChatRequest,
} from './types.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Local structural view that reads the ahiResolver field from the router
 * implementation without importing runtime values from core. The field is
 * optional because the AgentRouter interface declares it as a deferred
 * extension hook.
 */
interface RouterExtensionView {
  readonly ahiResolver?: AhiResolver | undefined;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Reads the handler for the given agent name from the router's manifest.
 */
function getHandlerFromRouter(
  router: AgentRouter,
  name: string
): AgentHandler | undefined {
  return router.manifest.agents.get(name);
}

/**
 * Bridges the handler's push-style streaming (`onChunk` callback during
 * execute()) into a pull-style ReadableStream<ChatChunk> for the SSE response
 * builder. Errors thrown by execute() before the first chunk surface through
 * controller.error so the SSE builder can emit the appropriate response.
 */
function invokeHandlerAsStream(
  handler: AgentHandler,
  messages: unknown,
  signal: AbortSignal
): ReadableStream<ChatChunk> {
  return new ReadableStream<ChatChunk>({
    start(controller) {
      void (async () => {
        try {
          await handler.execute(
            { params: { messages } },
            {
              onChunk: async (chunk: unknown) => {
                if (signal.aborted) return;
                controller.enqueue(chunk as ChatChunk);
              },
            }
          );
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      })();
    },
    cancel() {
      // Reader released; nothing to clean up. The handler's execute() has no
      // signal hook in RunContext yet; cancellation is best-effort.
    },
  });
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a chat harness wrapping an AgentRouter.
 *
 * Routes (all configurable via options.routes):
 *   POST /v1/chat/completions  — OpenAI-compatible; model field selects agent
 *   POST /agents/:name/chat    — per-agent chat
 *   POST /chat                 — default agent chat
 *   GET  /agents               — discovery; chat-eligible agents only
 *
 * Always-present routes:
 *   GET  /health               — returns 200 "OK"
 *   GET  /metrics              — returns JSON metrics counters
 *
 * Throws ChatSignatureError if defaultAgent route is enabled but the default
 * agent is missing or its declared signature is not chat-eligible (see
 * inspectChatHandler).
 */
export function createChatHarness(
  router: AgentRouter,
  options?: ChatHarnessOptions
): ChatHarness {
  if (router === null || router === undefined) {
    throw new TypeError('router is required');
  }

  const routeFlags = {
    openai: options?.routes?.openai !== false,
    perAgent: options?.routes?.perAgent !== false,
    defaultAgent: options?.routes?.defaultAgent !== false,
    discovery: options?.routes?.discovery !== false,
  };

  // One-time signature inspection at construction time. Capture each rejection
  // reason so the error message points the agent author at the exact mismatch.
  const eligibleAgents = new Set<string>();
  const ineligibleReasons = new Map<string, string>();
  for (const name of router.agents()) {
    const handler = getHandlerFromRouter(router, name);
    if (handler !== undefined) {
      const result = inspectChatHandler(handler);
      if (result.eligible) {
        eligibleAgents.add(name);
      } else {
        ineligibleReasons.set(name, result.reason);
      }
    }
  }

  const defaultAgentName = router.defaultAgent();

  if (routeFlags.defaultAgent) {
    if (
      defaultAgentName === '' ||
      !router.agents().includes(defaultAgentName)
    ) {
      throw new ChatSignatureError(
        `Default agent "${defaultAgentName}" is not a known agent`
      );
    }
    if (!eligibleAgents.has(defaultAgentName)) {
      const reason =
        ineligibleReasons.get(defaultAgentName) ?? 'unknown reason';
      throw new ChatSignatureError(
        `Default agent "${defaultAgentName}" has incompatible chat signature: ${reason}`
      );
    }
  }

  // AHI resolver is wired into agent handlers via createRouter()'s init step;
  // the chat harness no longer threads it per-request because handlers invoke
  // sibling agents through the resolver they captured at init time.
  void (router as unknown as RouterExtensionView).ahiResolver;

  const lifecycle = createHarnessLifecycle();
  const app = lifecycle.app;

  // Metrics counters
  let requests = 0;
  let errors = 0;
  let activeConnections = 0;

  // ============================================================
  // MIDDLEWARE
  // ============================================================

  if (options?.cors === true) {
    app.use('*', cors());
  }

  // ============================================================
  // PROBE ROUTES
  // ============================================================

  app.get('/health', (c) => c.text('OK', 200));

  app.get('/metrics', (c) =>
    c.json({
      requests,
      errors,
      active_connections: activeConnections,
    })
  );

  // ============================================================
  // STREAMING HELPER
  // ============================================================

  /**
   * Wraps a chat source in a TransformStream passthrough, pipes it through
   * createChatStreamResponse, and manages activeConnections/requests counters.
   *
   * Increments activeConnections on entry. Decrements activeConnections and
   * increments requests in the stream finally block (success or error). On a
   * pre-first-chunk exception from createChatStreamResponse, increments both
   * errors and requests and returns HTTP 500 JSON.
   */
  async function streamChatResponse(
    source: AsyncIterable<ChatChunk> | ReadableStream<ChatChunk>,
    resolvedAgent: string,
    abortController: AbortController
  ): Promise<Response> {
    activeConnections++;

    // Wrap the source in a TransformStream so we can decrement
    // activeConnections when the stream closes or is cancelled.
    const { readable, writable } = new TransformStream<ChatChunk, ChatChunk>();

    // Pipe source into the transform passthrough, then signal completion.
    (async () => {
      const writer = writable.getWriter();
      try {
        if (Symbol.asyncIterator in source) {
          for await (const chunk of source as AsyncIterable<ChatChunk>) {
            await writer.write(chunk);
          }
        } else {
          const reader = (source as ReadableStream<ChatChunk>).getReader();
          try {
            let result = await reader.read();
            while (!result.done) {
              await writer.write(result.value);
              result = await reader.read();
            }
          } finally {
            reader.releaseLock();
          }
        }
        await writer.close();
      } catch (err) {
        await writer.abort(err);
      } finally {
        activeConnections--;
        requests++;
      }
    })().catch(() => {
      // Errors are surfaced via the writable abort above; suppress unhandled.
    });

    try {
      return await createChatStreamResponse(readable, {
        model: resolvedAgent,
        abortController,
      });
    } catch (err) {
      // The handler threw before yielding its first chunk.
      errors++;
      requests++;
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: { message: msg } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ============================================================
  // CHAT REQUEST HANDLER
  // ============================================================

  async function handleChatRequest(
    c: Context,
    agentName: string,
    defaultFallback: boolean
  ): Promise<Response> {
    // Parse body
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await c.req.json();
      body = assertJsonObject(parsed);
    } catch (err) {
      errors++;
      requests++;
      return c.json(
        {
          error: {
            message: err instanceof Error ? err.message : 'Invalid JSON',
          },
        },
        400
      );
    }

    // Validate messages
    const validation = validateMessages(body['messages']);
    if (!validation.valid) {
      errors++;
      requests++;
      return c.json({ error: { message: validation.error } }, 400);
    }

    // Resolve agent: fall back to default when caller did not name one
    let resolvedAgent = agentName;
    if (
      !router.agents().includes(resolvedAgent) ||
      !eligibleAgents.has(resolvedAgent)
    ) {
      if (defaultFallback && eligibleAgents.has(defaultAgentName)) {
        resolvedAgent = defaultAgentName;
      } else if (defaultFallback) {
        errors++;
        requests++;
        return c.json(
          { error: { message: 'No default agent configured' } },
          500
        );
      } else {
        errors++;
        requests++;
        return c.json(
          { error: { message: `Agent "${agentName}" not found` } },
          404
        );
      }
    }

    // Build ChatRequest
    const chatReq: ChatRequest = {
      messages: validation.messages,
      ...(typeof body['model'] === 'string' ? { model: body['model'] } : {}),
      ...(typeof body['stream'] === 'boolean'
        ? { stream: body['stream'] }
        : {}),
    };

    // AbortController: aborted on client disconnect. Currently surfaced only
    // to the stream pump; RunContext does not yet carry an AbortSignal for the
    // handler itself (see [LIB] follow-up).
    const abortController = new AbortController();

    const handler = getHandlerFromRouter(router, resolvedAgent);
    if (handler === undefined) {
      errors++;
      requests++;
      return c.json(
        {
          error: { message: `Agent "${resolvedAgent}" handler not accessible` },
        },
        500
      );
    }

    const source = invokeHandlerAsStream(
      handler,
      chatReq.messages,
      abortController.signal
    );

    return streamChatResponse(source, resolvedAgent, abortController);
  }

  // ============================================================
  // CHAT ROUTES
  // ============================================================

  if (routeFlags.perAgent) {
    app.post('/agents/:name/chat', async (c) => {
      const name = c.req.param('name');
      return handleChatRequest(c, name, false);
    });
  }

  if (routeFlags.openai) {
    app.post('/v1/chat/completions', async (c) => {
      // Resolve agent from request body's model field. Missing/empty/unknown
      // model falls back to the default agent.
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = await c.req.json();
        body = assertJsonObject(parsed);
      } catch (err) {
        errors++;
        requests++;
        return c.json(
          {
            error: {
              message: err instanceof Error ? err.message : 'Invalid JSON',
            },
          },
          400
        );
      }

      const modelName =
        typeof body['model'] === 'string' && body['model'] !== ''
          ? body['model']
          : defaultAgentName;

      // Re-use a synthetic context to pass the already-parsed body.
      // Since handleChatRequest re-parses the body from c.req.json(), we
      // need a different approach: call the resolution inline here.
      const validation = validateMessages(body['messages']);
      if (!validation.valid) {
        errors++;
        requests++;
        return c.json({ error: { message: validation.error } }, 400);
      }

      // Resolve agent: model field names the agent; fall back to default.
      let resolvedAgent = modelName;
      if (
        !router.agents().includes(resolvedAgent) ||
        !eligibleAgents.has(resolvedAgent)
      ) {
        if (eligibleAgents.has(defaultAgentName)) {
          resolvedAgent = defaultAgentName;
        } else {
          errors++;
          requests++;
          return c.json(
            { error: { message: `Agent "${modelName}" not found` } },
            404
          );
        }
      }

      const abortController = new AbortController();

      const handler = getHandlerFromRouter(router, resolvedAgent);
      if (handler === undefined) {
        errors++;
        requests++;
        return c.json(
          {
            error: {
              message: `Agent "${resolvedAgent}" handler not accessible`,
            },
          },
          500
        );
      }

      const source = invokeHandlerAsStream(
        handler,
        validation.messages,
        abortController.signal
      );

      return streamChatResponse(source, resolvedAgent, abortController);
    });
  }

  if (routeFlags.defaultAgent) {
    app.post('/chat', async (c) => {
      return handleChatRequest(c, defaultAgentName, true);
    });
  }

  if (routeFlags.discovery) {
    app.get('/agents', (c) => {
      requests++;
      const agents = router
        .agents()
        .filter((n) => eligibleAgents.has(n))
        .map((n) => ({
          name: n,
          description: router.describe(n)?.description,
          default: n === defaultAgentName,
        }));
      return c.json({ agents });
    });
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  return {
    app,
    listen: (port?: number) => lifecycle.listen(port ?? options?.port ?? 3000),
    close: lifecycle.close,
  };
}
