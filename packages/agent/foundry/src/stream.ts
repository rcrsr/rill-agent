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
}

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
  /** Promise that resolves with the agent result text. */
  readonly resultPromise: Promise<string>;
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

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Keep-alive: SSE comments every 15s matching Python SDK's KEEP_ALIVE_INTERVAL
      keepAliveTimer = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }
      }, 15_000);

      options.resultPromise
        .then((resultText) => {
          if (closed) return;
          clearKeepAlive();

          // Emit word-by-word deltas matching Python server.py pattern
          const tokens = resultText.split(' ');
          for (let i = 0; i < tokens.length; i++) {
            const piece =
              i === tokens.length - 1 ? tokens[i]! : tokens[i] + ' ';
            controller.enqueue(
              ev('response.output_text.delta', {
                type: 'response.output_text.delta',
                delta: piece,
              })
            );
          }

          controller.enqueue(
            ev('response.output_text.done', {
              type: 'response.output_text.done',
              text: resultText,
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
        })
        .catch((err) => {
          clearKeepAlive();
          options.onError?.(err);
          const message = err instanceof Error ? err.message : String(err);
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
        });
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
