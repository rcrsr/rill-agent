import { describe, it, expect } from 'vitest';
import type { ChatChunk, UsageMetadata } from '../src/types.js';
import { defaultBody, harnessFor, makeErrorChunk } from './_fixtures.js';

// ============================================================
// LOCAL HELPERS
// ============================================================

/**
 * Buffered-path chat chunk carrying a single content delta. finish_reason
 * defaults to null so intermediate chunks in a sequence don't prematurely
 * resolve the assembled response's finish_reason; pass 'stop' on the true
 * last chunk of a sequence.
 */
function contentChunk(
  content: string,
  finishReason: ChatChunk['choices'][0]['finish_reason'] = null
): ChatChunk {
  return {
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
  };
}

/** Chunk carrying only usage metadata, terminating the sequence. */
function usageChunk(usage: UsageMetadata): ChatChunk {
  return {
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage,
  };
}

interface ChatCompletionBody {
  id: string;
  object: string;
  choices: [
    {
      index: number;
      message: { role: string; content: string };
      finish_reason: string;
    },
  ];
  usage?: UsageMetadata;
}

interface ChatErrorBody {
  error: { message: string };
}

// ============================================================
// STREAM:FALSE — BUFFERED CHAT.COMPLETION RESPONSE
// ============================================================

describe('buffered chat.completion response — stream:false', () => {
  it('returns a chat.completion JSON body with ordered concatenated content', async () => {
    const harness = await harnessFor({
      chunks: [contentChunk('A'), contentChunk('B'), contentChunk('C', 'stop')],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody({ stream: false })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as ChatCompletionBody;
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.role).toBe('assistant');
    expect(body.choices[0].message.content).toBe('ABC');
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.choices[0].finish_reason).toBe('stop');
  });
});

// ============================================================
// OMITTED STREAM FIELD — DEFAULT-BEHAVIOR CHECK
// ============================================================

describe('omitted stream field — falsifiable default-behavior check', () => {
  it('defaults to the buffered JSON path when the stream field is absent', async () => {
    const harness = await harnessFor({
      chunks: [contentChunk('A'), contentChunk('B'), contentChunk('C', 'stop')],
    });

    // defaultBody() with no overrides omits `stream` entirely.
    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as ChatCompletionBody;
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.role).toBe('assistant');
    expect(body.choices[0].message.content).toBe('ABC');
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.choices[0].finish_reason).toBe('stop');
  });
});

// ============================================================
// STREAM:TRUE — SSE PATH UNCHANGED
// ============================================================

describe('stream:true — SSE path unchanged', () => {
  it('returns text/event-stream when stream is explicitly true', async () => {
    const harness = await harnessFor({ chunks: [contentChunk('A', 'stop')] });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody({ stream: true })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });
});

// ============================================================
// IN-BAND ERROR CHUNK — BUFFERED PATH
// ============================================================

describe('in-band error chunk on the buffered path', () => {
  it('returns HTTP 500 JSON when a chunk carries finish_reason error', async () => {
    const harness = await harnessFor({
      chunks: [contentChunk('partial'), makeErrorChunk('boom mid-buffer')],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody({ stream: false })
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as ChatErrorBody;
    expect(body.error.message).toContain('boom mid-buffer');
  });
});

// ============================================================
// PRE-FIRST-CHUNK THROW — BUFFERED PATH PARITY
// ============================================================

describe('pre-first-chunk handler error on the buffered path', () => {
  it('returns HTTP 500 JSON, matching the streaming path', async () => {
    const harness = await harnessFor({
      throwBefore: new Error('buffered handler blew up early'),
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody({ stream: false })
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as ChatErrorBody;
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message).not.toContain('buffered handler blew up early');
    expect(body.error.message).toBe('Internal server error');
  });
});

// ============================================================
// USAGE METADATA — PRESENT/ABSENT ROUND-TRIP
// ============================================================

describe('usage metadata on the buffered path', () => {
  it('includes usage in the assembled body when a chunk carries it', async () => {
    const usage: UsageMetadata = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    };
    const harness = await harnessFor({
      chunks: [contentChunk('hi'), usageChunk(usage)],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody({ stream: false })
    );

    const body = (await res.json()) as ChatCompletionBody;
    expect(body.usage).toEqual(usage);
  });

  it('omits the usage field when no chunk carries it', async () => {
    const harness = await harnessFor({
      chunks: [contentChunk('hi', 'stop')],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody({ stream: false })
    );

    const body = (await res.json()) as ChatCompletionBody;
    expect(body.usage).toBeUndefined();
    expect('usage' in body).toBe(false);
  });
});

// ============================================================
// STREAM:FALSE ACROSS ALL CHAT ROUTES
// ============================================================

describe('stream:false JSON assertion across all chat routes', () => {
  it.each(['/chat', '/agents/t/chat', '/v1/chat/completions'])(
    'returns a chat.completion JSON body at %s',
    async (path) => {
      const harness = await harnessFor({
        chunks: [
          contentChunk('A'),
          contentChunk('B'),
          contentChunk('C', 'stop'),
        ],
      });

      const res = await harness.app.request(
        path,
        defaultBody({ stream: false })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const body = (await res.json()) as ChatCompletionBody;
      expect(body.object).toBe('chat.completion');
      expect(body.choices[0].message.role).toBe('assistant');
      expect(body.choices[0].message.content).toBe('ABC');
      expect(body.id).toMatch(/^chatcmpl-/);
      expect(body.choices[0].finish_reason).toBe('stop');
    }
  );
});
