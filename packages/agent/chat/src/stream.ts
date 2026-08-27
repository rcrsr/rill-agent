import { ChatChunkError } from './errors.js';
import type { ChatChunk, UsageMetadata } from './types.js';

// ============================================================
// TYPES
// ============================================================

export interface ChatStreamOptions {
  /** Agent name used to fill the `model` field when the chunk omits it. */
  readonly model: string;
  /**
   * AbortController whose signal is passed to the handler. Its `abort()`
   * method is called when the client disconnects (ReadableStream cancel).
   */
  readonly abortController: AbortController;
  /**
   * Invoked only for a genuine post-first-chunk handler failure caught while
   * the client is still connected, so the caller can record it in its own
   * error metrics. Not invoked when the failure is a rejection caused by the
   * client disconnecting (the controller is already closed at that point).
   * The pre-first-chunk failure path does not call this either — it throws
   * synchronously instead and the caller accounts for it directly.
   */
  readonly onError?: ((err: unknown) => void) | undefined;
}

// ============================================================
// HELPERS
// ============================================================

const encoder = new TextEncoder();

/**
 * Fills omitted auto-fill fields on a chunk, preserving values the handler
 * already provided. A stable `id` and `created` are generated once per
 * stream and reused across all chunks.
 */
function fillChunk(
  chunk: ChatChunk,
  defaults: { id: string; created: number; model: string }
): ChatChunk {
  return {
    id: chunk.id ?? defaults.id,
    object: chunk.object ?? 'chat.completion.chunk',
    created: chunk.created ?? defaults.created,
    model: chunk.model ?? defaults.model,
    choices: chunk.choices,
    ...(chunk.usage !== undefined ? { usage: chunk.usage } : {}),
  };
}

/**
 * Encodes a ChatChunk as an SSE data frame: `data: <json>\n\n`.
 */
function encodeChunk(chunk: ChatChunk): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

/** Terminal SSE frame consumed by OpenAI-compatible clients. */
const DONE_FRAME = encoder.encode('data: [DONE]\n\n');

/**
 * Builds an in-band error chunk for post-first-chunk failures. The message
 * is a fixed generic string, not derived from the underlying exception:
 * this path is only reached for a genuinely thrown handler exception, so
 * exposing its detail would leak internal exception/stack text to the
 * client. The real error is logged server-side by the caller.
 */
function buildErrorChunk(defaults: {
  id: string;
  created: number;
  model: string;
}): ChatChunk {
  return {
    id: defaults.id,
    object: 'chat.completion.chunk',
    created: defaults.created,
    model: defaults.model,
    choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
    error: { message: 'Internal server error' },
  };
}

// ============================================================
// SSE RESPONSE BUILDER
// ============================================================

/**
 * Builds a streaming SSE `Response` from a ChatChunk source.
 *
 * Two-phase approach for pre-chunk vs post-chunk failure distinction:
 * - Awaits the first iterator result before constructing the Response.
 * - If the first `next()` throws, this function throws synchronously so
 *   the caller can map the error to an HTTP 500.
 * - If the first `next()` yields, the Response is constructed. Any
 *   subsequent errors emit an in-band error SSE frame followed by [DONE].
 */
export async function createChatStreamResponse(
  source: AsyncIterable<ChatChunk> | ReadableStream<ChatChunk>,
  options: ChatStreamOptions
): Promise<Response> {
  // ReadableStream implements Symbol.asyncIterator natively in Node 18+ but
  // may not carry the type in older typings — cast for compatibility.
  const iterable = source as AsyncIterable<ChatChunk>;
  const iter = iterable[Symbol.asyncIterator]();

  // Stable defaults computed once per stream.
  const streamId = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const defaults = { id: streamId, created, model: options.model };

  // Phase 1: peek the first chunk. Throws if the source errors before
  // producing any output — the caller maps this to HTTP 500.
  const firstResult = await iter.next();

  // Source was empty: emit [DONE] immediately and return.
  if (firstResult.done === true) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(DONE_FRAME);
        controller.close();
      },
      cancel() {
        options.abortController.abort();
      },
    });
    return new Response(body, { status: 200, headers: sseHeaders() });
  }

  // Phase 2: first chunk succeeded. Buffer it and stream the rest.
  const firstChunk = fillChunk(firstResult.value, defaults);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        // Emit the buffered first chunk.
        controller.enqueue(encodeChunk(firstChunk));

        // Stream remaining chunks.
        let result = await iter.next();
        while (result.done !== true) {
          controller.enqueue(encodeChunk(fillChunk(result.value, defaults)));
          result = await iter.next();
        }

        // Normal completion.
        controller.enqueue(DONE_FRAME);
        controller.close();
      })().catch((err: unknown) => {
        // Guard against the stream having been cancelled by the consumer.
        // options.abortController is aborted synchronously by this stream's
        // own cancel() below, so this reliably distinguishes a cancellation
        // (no handler failure involved — absorbed silently, no logging or
        // error accounting) from a genuine mid-stream handler exception.
        // desiredSize === null also covers the cancellation case (cancel()
        // closes the controller), so it is not an exclusively non-cancellation
        // guard — it is a general check against enqueuing on a controller
        // that can no longer accept data (closed, errored, or cancelled).
        if (
          options.abortController.signal.aborted ||
          controller.desiredSize === null
        ) {
          return;
        }
        // Post-first-chunk failure: emit in-band error frame then [DONE].
        // The real error is logged server-side; the client only sees the
        // generic message built by buildErrorChunk.
        console.error(err);
        options.onError?.(err);
        try {
          controller.enqueue(encodeChunk(buildErrorChunk(defaults)));
          controller.enqueue(DONE_FRAME);
          controller.close();
        } catch {
          // Stream was cancelled between the guard check and enqueue.
        }
      });
    },

    cancel() {
      options.abortController.abort();
    },
  });

  return new Response(body, { status: 200, headers: sseHeaders() });
}

// ============================================================
// JSON RESPONSE BUILDER
// ============================================================

export interface ChatCompletionOptions {
  readonly model: string;
}

/**
 * Checks a chunk for an in-band error signal (finish_reason:'error' or an
 * `error` field) and throws if found, so the caller maps it to HTTP 500.
 */
function checkChunkForError(chunk: ChatChunk): void {
  const finishReason = chunk.choices[0]?.finish_reason;
  if (finishReason === 'error' || chunk.error !== undefined) {
    throw new ChatChunkError(chunk.error?.message ?? 'stream error');
  }
}

/**
 * Builds a buffered, non-streaming `Response` from a ChatChunk source.
 *
 * Mirrors createChatStreamResponse's peek-first-chunk approach: a
 * pre-first-chunk throw propagates synchronously so the caller maps it to
 * HTTP 500. All chunks (including the peeked first one) are then buffered
 * and assembled into a single chat.completion JSON object.
 */
export async function createChatCompletionResponse(
  source: AsyncIterable<ChatChunk> | ReadableStream<ChatChunk>,
  options: ChatCompletionOptions
): Promise<Response> {
  // ReadableStream implements Symbol.asyncIterator natively in Node 18+ but
  // may not carry the type in older typings — cast for compatibility.
  const iterable = source as AsyncIterable<ChatChunk>;
  const iter = iterable[Symbol.asyncIterator]();

  // Stable defaults computed once per response.
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  // Phase 1: peek the first chunk. Throws if the source errors before
  // producing any output — the caller maps this to HTTP 500.
  const firstResult = await iter.next();

  let content = '';
  let lastFinishReason: 'stop' | 'length' | null | undefined;
  let usage: UsageMetadata | undefined;

  if (firstResult.done !== true) {
    checkChunkForError(firstResult.value);
    ({ content, lastFinishReason, usage } = accumulateChunk(
      firstResult.value,
      content,
      usage
    ));

    // Phase 2: buffer remaining chunks.
    let result = await iter.next();
    while (result.done !== true) {
      checkChunkForError(result.value);
      ({ content, lastFinishReason, usage } = accumulateChunk(
        result.value,
        content,
        usage
      ));
      result = await iter.next();
    }
  }

  // Per spec, finish_reason reflects only the true last chunk: its value
  // when defined and non-null, otherwise 'stop'. Earlier chunks' values are
  // not carried forward.
  const finishReason: 'stop' | 'length' =
    lastFinishReason !== undefined && lastFinishReason !== null
      ? lastFinishReason
      : 'stop';

  const body = {
    id,
    object: 'chat.completion' as const,
    created,
    model: options.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: finishReason,
      },
    ],
    ...(usage !== undefined ? { usage } : {}),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Folds a single chunk into the running content/usage accumulators used by
 * createChatCompletionResponse, and records this chunk's raw finish_reason
 * (not folded — the caller resolves the final value from the true last
 * chunk only, per spec). checkChunkForError has already thrown for any
 * chunk whose finish_reason is 'error' before this runs, so 'error' is
 * unreachable here.
 */
function accumulateChunk(
  chunk: ChatChunk,
  content: string,
  usage: UsageMetadata | undefined
): {
  content: string;
  lastFinishReason: 'stop' | 'length' | null | undefined;
  usage: UsageMetadata | undefined;
} {
  const delta = chunk.choices[0]?.delta.content;
  const nextContent = delta !== undefined ? content + delta : content;

  const nextUsage = chunk.usage !== undefined ? chunk.usage : usage;

  return {
    content: nextContent,
    lastFinishReason: chunk.choices[0]?.finish_reason as
      | 'stop'
      | 'length'
      | null
      | undefined,
    usage: nextUsage,
  };
}

// ============================================================
// RESPONSE HEADERS
// ============================================================

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };
}
