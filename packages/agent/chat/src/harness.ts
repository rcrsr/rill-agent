import type { Context } from 'hono';
import { cors } from 'hono/cors';
import {
  assertJsonObject,
  createHarnessLifecycle,
} from '@rcrsr/rill-agent-hono-kit';
import type { AgentHandler, AgentRouter } from '@rcrsr/rill-agent';
import { ChatChunkError, ChatSignatureError } from './errors.js';
import { inspectChatHandler } from './eligibility.js';
import {
  createChatCompletionResponse,
  createChatStreamResponse,
} from './stream.js';
import { validateMessages } from './validate.js';
import type {
  ChatChunk,
  ChatHarness,
  ChatHarnessOptions,
  ChatRequest,
} from './types.js';

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
  abortController: AbortController
): ReadableStream<ChatChunk> {
  return new ReadableStream<ChatChunk>({
    start(controller) {
      void (async () => {
        try {
          await handler.execute(
            { params: { messages } },
            {
              signal: abortController.signal,
              onChunk: async (chunk: unknown) => {
                if (abortController.signal.aborted) return;
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
      abortController.abort();
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
  // the chat harness does not thread it per-request because handlers invoke
  // sibling agents through the resolver they captured at init time.

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
   * increments requests in the stream finally block (success or error) —
   * this is the sole `requests` increment for this path, since the pump's
   * `finally` always runs regardless of where the failure occurs. On a
   * pre-first-chunk exception from createChatStreamResponse, increments only
   * errors and returns HTTP 500 JSON.
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
            if (abortController.signal.aborted) break;
            await writer.write(chunk);
          }
        } else {
          const reader = (source as ReadableStream<ChatChunk>).getReader();
          try {
            let result = await reader.read();
            while (!result.done) {
              if (abortController.signal.aborted) {
                await reader.cancel();
                break;
              }
              await writer.write(result.value);
              result = await reader.read();
            }
          } finally {
            reader.releaseLock();
          }
        }
        if (abortController.signal.aborted) {
          await writer.abort();
        } else {
          await writer.close();
        }
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
        onError: () => {
          errors++;
        },
      });
    } catch (err) {
      // The handler threw before yielding its first chunk. The exception
      // detail is logged server-side only; the client receives a generic
      // message so internals (stack traces, error text) are not exposed.
      console.error(err);
      errors++;
      return new Response(
        JSON.stringify({ error: { message: 'Internal server error' } }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // ============================================================
  // BUFFERED RESPONSE HELPER
  // ============================================================

  /**
   * Non-streaming counterpart to streamChatResponse. Mirrors its counter
   * accounting (activeConnections/requests/errors) but has no TransformStream
   * pump: the source is fully buffered by createChatCompletionResponse before
   * a single JSON response is returned.
   */
  async function bufferedChatResponse(
    source: AsyncIterable<ChatChunk> | ReadableStream<ChatChunk>,
    resolvedAgent: string
  ): Promise<Response> {
    activeConnections++;
    try {
      return await createChatCompletionResponse(source, {
        model: resolvedAgent,
      });
    } catch (err) {
      errors++;
      // A ChatChunkError carries a handler-emitted in-band error signal
      // (finish_reason: 'error'), not internal exception detail, so it is
      // safe to surface verbatim. Any other exception is logged server-side
      // only; the client receives a generic message so internals are not
      // exposed.
      if (err instanceof ChatChunkError) {
        return new Response(
          JSON.stringify({ error: { message: err.message } }),
          {
            status: err.statusCode,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      console.error(err);
      return new Response(
        JSON.stringify({ error: { message: 'Internal server error' } }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } finally {
      activeConnections--;
      requests++;
    }
  }

  /**
   * Dispatches to the streaming or buffered response builder based on the
   * caller's `stream` field. Only `stream === true` selects SSE; any other
   * value (including missing/non-boolean) selects the buffered JSON path.
   */
  function dispatchChatResponse(
    source: AsyncIterable<ChatChunk> | ReadableStream<ChatChunk>,
    resolvedAgent: string,
    abortController: AbortController,
    wantsStream: boolean
  ): Promise<Response> {
    return wantsStream
      ? streamChatResponse(source, resolvedAgent, abortController)
      : bufferedChatResponse(source, resolvedAgent);
  }

  // ============================================================
  // BODY PARSING HELPER
  // ============================================================

  /**
   * Parses and validates the request body as a JSON object. Returns the
   * parsed body, or an error Response ready to be returned directly by the
   * caller. Callers own the errors/requests counter accounting for the
   * parse-failure path so each route's metrics stay consistent with its
   * other early-return branches.
   */
  async function parseChatBody(
    c: Context
  ): Promise<Record<string, unknown> | Response> {
    try {
      const parsed: unknown = await c.req.json();
      return assertJsonObject(parsed);
    } catch (err) {
      return c.json(
        {
          error: {
            message: err instanceof Error ? err.message : 'Invalid JSON',
          },
        },
        400
      );
    }
  }

  // ============================================================
  // CHAT REQUEST HANDLER
  // ============================================================

  /**
   * Shared handler for all three chat routes. `body` is already parsed by
   * the caller via parseChatBody. `agentName` is the caller-resolved agent
   * name to target (a route param, the default agent name, or the OpenAI
   * `model` field); `defaultFallback` controls whether an unknown/ineligible
   * `agentName` falls back to the default agent (500 if the default is also
   * missing/ineligible) or returns a 404 (per-agent route only).
   */
  async function handleChatRequest(
    c: Context,
    body: Record<string, unknown>,
    agentName: string,
    defaultFallback: boolean
  ): Promise<Response> {
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

    // AbortController: aborted on client disconnect. Surfaced to both the
    // stream pump and the handler via RunContext.signal.
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
      abortController
    );

    const wantsStream = chatReq.stream === true;
    return dispatchChatResponse(
      source,
      resolvedAgent,
      abortController,
      wantsStream
    );
  }

  // ============================================================
  // CHAT ROUTES
  // ============================================================

  if (routeFlags.perAgent) {
    app.post('/agents/:name/chat', async (c) => {
      const body = await parseChatBody(c);
      if (body instanceof Response) {
        errors++;
        requests++;
        return body;
      }
      const name = c.req.param('name');
      return handleChatRequest(c, body, name, false);
    });
  }

  if (routeFlags.openai) {
    app.post('/v1/chat/completions', async (c) => {
      const body = await parseChatBody(c);
      if (body instanceof Response) {
        errors++;
        requests++;
        return body;
      }
      // Resolve agent from request body's model field. Missing/empty/unknown
      // model falls back to the default agent.
      const agentName =
        typeof body['model'] === 'string' && body['model'] !== ''
          ? body['model']
          : defaultAgentName;
      return handleChatRequest(c, body, agentName, true);
    });
  }

  if (routeFlags.defaultAgent) {
    app.post('/chat', async (c) => {
      const body = await parseChatBody(c);
      if (body instanceof Response) {
        errors++;
        requests++;
        return body;
      }
      return handleChatRequest(c, body, defaultAgentName, true);
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
