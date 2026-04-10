import type { IdGenerator } from './id.js';

// ============================================================
// TYPES
// ============================================================

interface StreamOptions {
  readonly onError?: ((err: unknown) => void) | undefined;
  /** IdGenerator scoped to the request for correlated message IDs. */
  readonly idGenerator?: IdGenerator | undefined;
  /** Session ID echoed back in x-agent-session-id response header. */
  readonly sessionId?: string | undefined;
  /** Invocation ID echoed back in x-agent-invocation-id response header. */
  readonly invocationId?: string | undefined;
  /** Pre-built x-aml-foundry-agents-metadata JSON string. */
  readonly metadataHeader?: string | undefined;
  /**
   * When true, raw error messages are forwarded to clients. When false
   * (default), error events emit a generic message to avoid leaking
   * internal details. Mirrors the harness `debugErrors` option used by
   * `buildErrorResponse`.
   */
  readonly debugErrors?: boolean | undefined;
}

const REDACTED_ERROR_MESSAGE = 'Internal server error';

// ============================================================
// HELPERS
// ============================================================

const encoder = new TextEncoder();

/**
 * Format a named SSE event as a string.
 */
function sseChunk(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

// ============================================================
// RESPONSE HEADERS
// ============================================================

/**
 * Build the common SSE response headers.
 * Matches the Python SDK's create_response_headers() plus
 * Starlette StreamingResponse defaults.
 */
function sseHeaders(options?: StreamOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    'x-aml-foundry-agents-metadata':
      options?.metadataHeader ??
      JSON.stringify({
        package: { name: 'azure-ai-agentserver-core', version: '1.0.0b17' },
        runtime: {
          python_version: '3.11.0',
          platform: 'Linux',
          host_name: '',
          replica_name: '',
        },
      }),
  };
  if (options?.sessionId !== undefined) {
    headers['x-agent-session-id'] = options.sessionId;
  }
  if (options?.invocationId !== undefined) {
    headers['x-agent-invocation-id'] = options.invocationId;
  }
  return headers;
}

// ============================================================
// STREAMING RESPONSE (matches Python SDK minimal format)
// ============================================================

export interface StreamResponseOptions extends StreamOptions {
  /** Promise that resolves with the agent result text (flat mode). */
  readonly resultPromise?: Promise<string> | undefined;
  /** Async iterable of text chunks for real-time delta streaming. */
  readonly chunks?: AsyncIterable<string> | undefined;
  /** Called when the agent promise rejects. */
  readonly onError?: ((err: unknown) => void) | undefined;
}

/**
 * Create a streaming SSE Response matching the Python SDK's minimal
 * event format: only response.output_text.delta, response.output_text.done,
 * and response.completed events are emitted.
 *
 * No envelope events (response.created, response.in_progress, etc.)
 * are sent — the Python SDK does not inject them.
 */
export function createFoundryStreamResponse(
  responseId: string,
  options: StreamResponseOptions
): Response {
  let seq = 0;
  let closed = false;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  const clearKeepAlive = (): void => {
    if (keepAliveTimer !== undefined) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
  };

  function ev(event: string, payload: Record<string, unknown>): Uint8Array {
    payload['sequence_number'] = seq++;
    return encoder.encode(sseChunk(event, JSON.stringify(payload)));
  }

  function emitDeltas(
    controller: ReadableStreamDefaultController<Uint8Array>,
    fullText: string
  ): void {
    const tokens = fullText.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      const piece = i === tokens.length - 1 ? tokens[i]! : tokens[i] + ' ';
      controller.enqueue(
        ev('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: piece,
        })
      );
    }
  }

  function emitCompletion(
    controller: ReadableStreamDefaultController<Uint8Array>,
    fullText: string
  ): void {
    controller.enqueue(
      ev('response.output_text.done', {
        type: 'response.output_text.done',
        text: fullText,
      })
    );
    controller.enqueue(
      ev('response.completed', {
        type: 'response.completed',
        response: {
          object: 'response',
          id: responseId,
          status: 'completed',
          created_at: Math.floor(Date.now() / 1000),
          output: [],
        },
      })
    );
    closed = true;
    controller.close();
  }

  function emitError(
    controller: ReadableStreamDefaultController<Uint8Array>,
    err: unknown
  ): void {
    clearKeepAlive();
    options.onError?.(err);
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message =
      options.debugErrors === true ? rawMessage : REDACTED_ERROR_MESSAGE;
    controller.enqueue(
      encoder.encode(
        sseChunk(
          'error',
          JSON.stringify({
            type: 'error',
            sequence_number: seq++,
            code: 'SERVER_ERROR',
            message,
            param: '',
          })
        )
      )
    );
    closed = true;
    controller.close();
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      keepAliveTimer = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }
      }, 15_000);

      if (options.chunks !== undefined) {
        // Chunk streaming: emit each chunk as a delta event in real time.
        (async () => {
          let fullText = '';
          for await (const chunk of options.chunks!) {
            if (closed) break;
            fullText += chunk;
            controller.enqueue(
              ev('response.output_text.delta', {
                type: 'response.output_text.delta',
                delta: chunk,
              })
            );
          }
          if (closed) return;
          clearKeepAlive();
          emitCompletion(controller, fullText);
        })().catch((err) => emitError(controller, err));
      } else if (options.resultPromise !== undefined) {
        // Flat mode: wait for full text, then emit word-by-word deltas.
        options.resultPromise
          .then((resultText) => {
            if (closed) return;
            clearKeepAlive();
            emitDeltas(controller, resultText);
            emitCompletion(controller, resultText);
          })
          .catch((err) => emitError(controller, err));
      } else {
        clearKeepAlive();
        emitCompletion(controller, '');
      }
    },

    cancel() {
      closed = true;
      clearKeepAlive();
    },
  });

  return new Response(body, {
    status: 200,
    headers: sseHeaders(options),
  });
}

// ============================================================
// LEGACY EXPORTS (kept for test compatibility)
// ============================================================

/**
 * Stream a Foundry Responses lifecycle via SSE.
 * Delegates to createFoundryStreamResponse for all paths.
 */
export function streamFoundryResponse(
  _c: unknown,
  responseId: string,
  resultStream: AsyncIterable<{ value?: unknown }>,
  options: StreamOptions & { resultPromise?: Promise<string> }
): Response {
  // Convert resultStream to a promise if resultPromise not provided
  const resultPromise =
    options.resultPromise ??
    (async () => {
      let text = '';
      for await (const chunk of resultStream) {
        if (chunk.value !== null && chunk.value !== undefined) {
          text +=
            typeof chunk.value === 'string'
              ? chunk.value
              : JSON.stringify(chunk.value);
        }
      }
      return text;
    })();

  return createFoundryStreamResponse(responseId, {
    ...options,
    resultPromise,
  });
}
