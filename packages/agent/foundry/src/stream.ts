import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { generateId } from './id.js';

// ============================================================
// TYPES
// ============================================================

interface StreamOptions {
  readonly onError?: ((err: unknown) => void) | undefined;
}

// ============================================================
// HELPERS
// ============================================================

const KEEP_ALIVE_INTERVAL_MS = 15_000;

/**
 * Coerce an AsyncIterable chunk value to a string for SSE output.
 */
function coerceChunk(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

// ============================================================
// STREAM EMITTER
// ============================================================

/**
 * Stream a Foundry Responses lifecycle via SSE.
 *
 * Lifecycle events emitted in order:
 *   response.created → response.in_progress → response.output_item.added
 *   → response.content_part.added → response.output_text.delta (per chunk)
 *   → response.output_text.done → response.content_part.done
 *   → response.output_item.done → response.completed
 *
 * Keep-alive: SSE comment `:keep-alive` every 15 s during inactivity.
 * On error: emits `event: error` with `{type:"error", message:"..."}`.
 *
 * Warning: Hono SSE `onError` does not trigger Hono's top-level `onError`
 * hook. All error handling is self-contained within the streamSSE callback.
 */
export function streamFoundryResponse(
  c: Context,
  responseId: string,
  resultStream: AsyncIterable<{ value?: unknown }>,
  options: StreamOptions
): Response {
  const itemId = generateId('msg_');
  const createdAt = Math.floor(Date.now() / 1000);

  return streamSSE(c, async (stream) => {
    let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

    const clearKeepAlive = (): void => {
      if (keepAliveTimer !== undefined) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = undefined;
      }
    };

    stream.onAbort(() => {
      clearKeepAlive();
    });

    try {
      // Start keep-alive timer
      keepAliveTimer = setInterval(() => {
        void stream.write(': keep-alive\n\n');
      }, KEEP_ALIVE_INTERVAL_MS);

      // 1. response.created
      await stream.writeSSE({
        event: 'response.created',
        data: JSON.stringify({
          type: 'response.created',
          response: {
            id: responseId,
            object: 'response',
            created_at: createdAt,
            status: 'in_progress',
          },
        }),
      });

      // 2. response.in_progress
      await stream.writeSSE({
        event: 'response.in_progress',
        data: JSON.stringify({
          type: 'response.in_progress',
          response: { id: responseId, status: 'in_progress' },
        }),
      });

      // 3. response.output_item.added
      await stream.writeSSE({
        event: 'response.output_item.added',
        data: JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: itemId,
            type: 'message',
            role: 'assistant',
            status: 'in_progress',
          },
        }),
      });

      // 4. response.content_part.added
      await stream.writeSSE({
        event: 'response.content_part.added',
        data: JSON.stringify({
          type: 'response.content_part.added',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        }),
      });

      // 5. response.output_text.delta — repeated per chunk
      let fullText = '';
      for await (const chunk of resultStream) {
        const delta = coerceChunk(chunk.value);
        if (delta !== '') {
          fullText += delta;
          clearInterval(keepAliveTimer);
          keepAliveTimer = setInterval(() => {
            void stream.write(': keep-alive\n\n');
          }, KEEP_ALIVE_INTERVAL_MS);

          await stream.writeSSE({
            event: 'response.output_text.delta',
            data: JSON.stringify({
              type: 'response.output_text.delta',
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              delta,
            }),
          });
        }
      }

      clearKeepAlive();

      // 6. response.output_text.done
      await stream.writeSSE({
        event: 'response.output_text.done',
        data: JSON.stringify({
          type: 'response.output_text.done',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: fullText,
        }),
      });

      // 7. response.content_part.done
      await stream.writeSSE({
        event: 'response.content_part.done',
        data: JSON.stringify({
          type: 'response.content_part.done',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: fullText, annotations: [] },
        }),
      });

      // 8. response.output_item.done
      await stream.writeSSE({
        event: 'response.output_item.done',
        data: JSON.stringify({
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            id: itemId,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: fullText, annotations: [] }],
          },
        }),
      });

      // 9. response.completed
      await stream.writeSSE({
        event: 'response.completed',
        data: JSON.stringify({
          type: 'response.completed',
          response: {
            id: responseId,
            object: 'response',
            created_at: createdAt,
            status: 'completed',
            output: [
              {
                id: itemId,
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [
                  { type: 'output_text', text: fullText, annotations: [] },
                ],
              },
            ],
            error: null,
          },
        }),
      });
    } catch (err) {
      clearKeepAlive();
      options.onError?.(err);
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ type: 'error', message }),
      });
    }
  });
}
