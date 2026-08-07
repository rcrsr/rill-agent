import { describe, it, expect } from 'vitest';
import { createChatCompletionResponse } from '../src/stream.js';
import type { ChatChunk } from '../src/types.js';

// ============================================================
// LOCAL HELPERS
// ============================================================

/** Wraps a fixed chunk list as an async generator, the shape handlers use. */
async function* chunksOf(chunks: ChatChunk[]): AsyncGenerator<ChatChunk> {
  for (const c of chunks) yield c;
}

/** Async generator that yields the given chunks, then throws. */
async function* chunksThenThrow(
  chunks: ChatChunk[],
  err: unknown
): AsyncGenerator<ChatChunk> {
  for (const c of chunks) yield c;
  throw err;
}

/** Async iterable whose iterator rejects before yielding any chunk. */
function throwsBeforeFirst(err: unknown): AsyncIterable<ChatChunk> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(err),
    }),
  };
}

function chunk(
  content: string | undefined,
  finishReason: 'stop' | 'length' | 'error' | null | undefined = null
): ChatChunk {
  return {
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
  };
}

// ============================================================
// EMPTY SOURCE
// ============================================================

describe('createChatCompletionResponse — empty source', () => {
  it('returns HTTP 200 with empty content and finish_reason "stop"', async () => {
    const res = await createChatCompletionResponse(chunksOf([]), {
      model: 't',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as {
      choices: [{ message: { content: string }; finish_reason: string }];
    };
    expect(body.choices[0]?.message.content).toBe('');
    expect(body.choices[0]?.finish_reason).toBe('stop');
  });
});

// ============================================================
// CONTENT CONCATENATION
// ============================================================

describe('createChatCompletionResponse — content concatenation', () => {
  it('concatenates delta.content across chunks, skipping undefined deltas', async () => {
    const res = await createChatCompletionResponse(
      chunksOf([chunk('Hello, '), chunk(undefined), chunk('world', 'stop')]),
      { model: 't' }
    );

    const body = (await res.json()) as {
      choices: [{ message: { content: string } }];
    };
    expect(body.choices[0]?.message.content).toBe('Hello, world');
  });
});

// ============================================================
// FINISH_REASON — TRUE LAST CHUNK ONLY
// ============================================================

describe('createChatCompletionResponse — finish_reason', () => {
  it('defaults to "stop" when no chunk supplies a finish_reason', async () => {
    const res = await createChatCompletionResponse(
      chunksOf([chunk('a'), chunk('b')]),
      { model: 't' }
    );
    const body = (await res.json()) as {
      choices: [{ finish_reason: string }];
    };
    expect(body.choices[0]?.finish_reason).toBe('stop');
  });

  it("uses the last chunk's finish_reason when defined and non-null", async () => {
    const res = await createChatCompletionResponse(
      chunksOf([chunk('a'), chunk('b', 'length')]),
      { model: 't' }
    );
    const body = (await res.json()) as {
      choices: [{ finish_reason: string }];
    };
    expect(body.choices[0]?.finish_reason).toBe('length');
  });

  it('resolves to "stop" when the true last chunk has a null finish_reason, even if an earlier chunk set one', async () => {
    // Regression: an earlier implementation carried forward the last
    // *non-null* finish_reason across all chunks instead of looking only at
    // the true final chunk. Per spec, only the final chunk's value matters.
    const res = await createChatCompletionResponse(
      chunksOf([chunk('a', 'length'), chunk('b', null)]),
      { model: 't' }
    );
    const body = (await res.json()) as {
      choices: [{ finish_reason: string }];
    };
    expect(body.choices[0]?.finish_reason).toBe('stop');
  });
});

// ============================================================
// USAGE — LAST CHUNK THAT CARRIES ONE
// ============================================================

describe('createChatCompletionResponse — usage', () => {
  it('uses usage from the last chunk that carries one, ignoring later chunks without usage', async () => {
    const withUsage: ChatChunk = {
      ...chunk('a', null),
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    const res = await createChatCompletionResponse(
      chunksOf([withUsage, chunk('b', 'stop')]),
      { model: 't' }
    );
    const body = (await res.json()) as {
      usage?: { prompt_tokens: number };
    };
    expect(body.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 2,
      total_tokens: 7,
    });
  });

  it('omits usage entirely when no chunk carries one', async () => {
    const res = await createChatCompletionResponse(
      chunksOf([chunk('a'), chunk('b', 'stop')]),
      { model: 't' }
    );
    const body = (await res.json()) as { usage?: unknown };
    expect(body.usage).toBeUndefined();
  });
});

// ============================================================
// IN-BAND ERROR CHUNK
// ============================================================

describe('createChatCompletionResponse — in-band error chunk', () => {
  it('throws when a chunk carries finish_reason "error"', async () => {
    await expect(
      createChatCompletionResponse(
        chunksOf([chunk('a'), chunk(undefined, 'error')]),
        { model: 't' }
      )
    ).rejects.toThrow();
  });

  it('throws when a chunk carries an error field', async () => {
    const errChunk: ChatChunk = {
      choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
      error: { message: 'boom' },
    };
    await expect(
      createChatCompletionResponse(chunksOf([errChunk]), { model: 't' })
    ).rejects.toThrow('boom');
  });
});

// ============================================================
// PRE-FIRST-CHUNK THROW PROPAGATION
// ============================================================

describe('createChatCompletionResponse — pre-first-chunk failure', () => {
  it('propagates a throw that occurs before any chunk is yielded', async () => {
    await expect(
      createChatCompletionResponse(
        throwsBeforeFirst(new Error('source blew up before first chunk')),
        { model: 't' }
      )
    ).rejects.toThrow('source blew up before first chunk');
  });

  it('propagates a throw that occurs after some chunks have been yielded', async () => {
    await expect(
      createChatCompletionResponse(
        chunksThenThrow([chunk('a')], new Error('mid-buffer failure')),
        { model: 't' }
      )
    ).rejects.toThrow('mid-buffer failure');
  });
});
