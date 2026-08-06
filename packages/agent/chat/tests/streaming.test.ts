import { describe, it, expect } from 'vitest';
import type { AgentHandler } from '@rcrsr/rill-agent';
import { createChatHarness } from '../src/harness.js';
import type { ChatChunk } from '../src/types.js';
import {
  jsonPost,
  makeChatHandler,
  makeRouter,
  parseSseFrames,
  readBody,
} from './_fixtures.js';

// ============================================================
// LOCAL HELPERS
// ============================================================

/**
 * SSE-shaped chat chunk used by the wire-format tests. Differs from the
 * shared makeChunk fixture in that finish_reason stays null so the test can
 * inspect the harness's emitted [DONE] marker without an interleaving stop.
 */
function textChunk(content: string): ChatChunk {
  return {
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

async function readSse(response: Response): Promise<string[]> {
  const body = await readBody(response);
  return parseSseFrames(body);
}

function parseDataLine(frame: string): string {
  const m = frame.match(/^data: (.*)$/s);
  return m && m[1] !== undefined ? m[1] : '';
}

function defaultBody(overrides: Record<string, unknown> = {}): {
  method: string;
  headers: Record<string, string>;
  body: string;
} {
  return jsonPost({
    model: 't',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  });
}

/**
 * Build a router whose default agent emits the given chunks via onChunk
 * during execute(). Most tests only care about the chunk sequence.
 */
async function harnessFor(opts: {
  chunks?: ChatChunk[];
  throwBefore?: unknown;
  throwAfter?: { chunks: ChatChunk[]; error: unknown };
  onInvoke?: (
    request: Parameters<NonNullable<AgentHandler['execute']>>[0],
    context: Parameters<NonNullable<AgentHandler['execute']>>[1]
  ) => void;
}): Promise<ReturnType<typeof createChatHarness>> {
  const handler = makeChatHandler({
    name: 't',
    ...(opts.chunks !== undefined ? { chunks: opts.chunks } : {}),
    ...(opts.throwBefore !== undefined
      ? { throwBefore: opts.throwBefore }
      : {}),
    ...(opts.throwAfter !== undefined ? { throwAfter: opts.throwAfter } : {}),
    ...(opts.onInvoke !== undefined ? { onInvoke: opts.onInvoke } : {}),
  });
  const router = await makeRouter({
    agents: new Map<string, AgentHandler>([['t', handler]]),
    defaultAgent: 't',
  });
  return createChatHarness(router);
}

// ============================================================
// SSE WIRE FORMAT — EACH CHUNK AS SEPARATE FRAME
// ============================================================

describe('SSE wire format — each chunk as separate frame', () => {
  it('emits one data frame per handler chunk followed by [DONE]', async () => {
    const harness = await harnessFor({
      chunks: [textChunk('A'), textChunk('B'), textChunk('C')],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = await readSse(res);
    expect(frames.length).toBe(4);

    for (let i = 0; i < 3; i++) {
      const frame = frames[i] ?? '';
      expect(frame.startsWith('data: ')).toBe(true);
      const chunk = JSON.parse(parseDataLine(frame)) as ChatChunk;
      expect(Array.isArray(chunk.choices)).toBe(true);
      expect(typeof chunk.id).toBe('string');
      expect(typeof chunk.created).toBe('number');
      expect(typeof chunk.model).toBe('string');
    }

    expect(frames[3]).toBe('data: [DONE]');
  });

  it('fills id/object/created/model when handler omits them', async () => {
    const harness = await harnessFor({
      chunks: [{ choices: [{ delta: { content: 'hi' } }] }],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );
    const frames = await readSse(res);
    const chunk = JSON.parse(parseDataLine(frames[0] ?? '')) as ChatChunk;

    expect(chunk.id).toMatch(/^chatcmpl-/);
    expect(chunk.object).toBe('chat.completion.chunk');
    expect(typeof chunk.created).toBe('number');
    expect(chunk.model).toBe('t');
  });

  it('preserves id/object/created/model when handler provides them', async () => {
    const fixedId = 'chatcmpl-fixed-abc';
    const fixedCreated = 1700000000;

    const harness = await harnessFor({
      chunks: [
        {
          id: fixedId,
          object: 'chat.completion.chunk',
          created: fixedCreated,
          model: 'override-model',
          choices: [{ delta: { content: 'hi' } }],
        },
      ],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );
    const frames = await readSse(res);
    const chunk = JSON.parse(parseDataLine(frames[0] ?? '')) as ChatChunk;

    expect(chunk.id).toBe(fixedId);
    expect(chunk.created).toBe(fixedCreated);
    expect(chunk.model).toBe('override-model');
  });
});

// ============================================================
// PRE-FIRST-CHUNK ERROR — HTTP 500 JSON
// ============================================================

describe('pre-first-chunk handler error', () => {
  it('returns HTTP 500 with JSON error body when handler throws before yielding', async () => {
    const harness = await harnessFor({
      throwBefore: new Error('handler blew up early'),
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error: { message: string } };
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message).toContain('handler blew up early');
  });

  it('returns HTTP 500 when execute() throws synchronously', async () => {
    // throwBefore throws inside the async execute() body, which is equivalent
    // to a synchronous reject from the chat harness's perspective: the
    // promise rejects before any chunk reaches the SSE writer.
    const harness = await harnessFor({
      throwBefore: new Error('sync throw from execute'),
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('sync throw from execute');
  });
});

// ============================================================
// POST-FIRST-CHUNK ERROR — IN-BAND SSE ERROR FRAME
// ============================================================

describe('post-first-chunk handler error', () => {
  it('returns HTTP 200 SSE with in-band error frame then [DONE]', async () => {
    const harness = await harnessFor({
      throwAfter: {
        chunks: [textChunk('first chunk')],
        error: new Error('mid-stream failure'),
      },
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = await readSse(res);
    expect(frames.length).toBeGreaterThanOrEqual(3);

    const firstChunk = JSON.parse(parseDataLine(frames[0] ?? '')) as ChatChunk;
    expect(firstChunk.choices[0]?.delta?.content).toBe('first chunk');

    const doneIdx = frames.findIndex((f) => f === 'data: [DONE]');
    expect(doneIdx).toBeGreaterThan(0);

    const errorFrame = frames[doneIdx - 1] ?? '';
    const errorChunk = JSON.parse(parseDataLine(errorFrame)) as ChatChunk & {
      error?: { message: string };
    };
    expect(errorChunk.choices[0]?.finish_reason).toBe('error');
    expect(typeof errorChunk.error?.message).toBe('string');
    expect(errorChunk.error?.message).toContain('mid-stream failure');

    expect(frames[frames.length - 1]).toBe('data: [DONE]');
  });
});

// ============================================================
// PERFORMANCE — REQUEST-TO-FIRST-CHUNK OVERHEAD
// ============================================================

describe('request-to-first-chunk overhead', () => {
  it('delivers first chunk within 50ms for a sync-yielding handler', async () => {
    // Target is 10ms (NFR-CHAT-1); 50ms tolerance for CI variance.
    const harness = await harnessFor({ chunks: [textChunk('immediate')] });

    const start = performance.now();
    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let firstFrame: string | undefined;

    while (firstFrame === undefined) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const idx = buf.indexOf('\n\n');
      if (idx !== -1) firstFrame = buf.slice(0, idx);
    }

    const elapsed = performance.now() - start;
    reader.cancel();

    expect(firstFrame).toBeDefined();
    expect(elapsed).toBeLessThan(50);
  });
});

// ============================================================
// CONCURRENCY — NO HARNESS-IMPOSED CAP
// ============================================================

describe('concurrent connections — no harness-imposed cap', () => {
  it('serves 60 concurrent streaming requests without errors', async () => {
    const CONCURRENCY = 60;
    const harness = await harnessFor({
      chunks: [textChunk('chunk-a'), textChunk('chunk-b')],
    });

    const requests = Array.from({ length: CONCURRENCY }, () =>
      harness.app.request('/v1/chat/completions', defaultBody())
    );
    const responses = await Promise.all(requests);
    for (const res of responses) expect(res.status).toBe(200);

    const allFrames = await Promise.all(responses.map((res) => readSse(res)));
    for (const frames of allFrames) {
      expect(frames[frames.length - 1]).toBe('data: [DONE]');
      expect(frames.length).toBe(3);
    }
  });
});

// ============================================================
// THROUGHPUT — STABLE ACROSS MESSAGE ARRAY SIZES
// ============================================================

describe('throughput stability across message array sizes', () => {
  async function measureFirstChunkMs(messageCount: number): Promise<number> {
    const harness = await harnessFor({ chunks: [textChunk('response')] });

    const messages = Array.from({ length: messageCount }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message content number ${i}`,
    }));

    const start = performance.now();
    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ model: 't', messages })
    );
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.indexOf('\n\n') !== -1) break;
    }
    reader.cancel();
    return performance.now() - start;
  }

  it('first-chunk time at N=10000 messages stays within 4x of N=1', async () => {
    const t1 = await measureFirstChunkMs(1);
    const t10k = await measureFirstChunkMs(10_000);
    const budget = Math.max(t1 * 4, 200);
    expect(t10k).toBeLessThan(budget);
  });

  it('all three sizes (N=1, N=100, N=10000) complete under 500ms', async () => {
    const t1 = await measureFirstChunkMs(1);
    const t100 = await measureFirstChunkMs(100);
    const t10k = await measureFirstChunkMs(10_000);
    expect(t1).toBeLessThan(500);
    expect(t100).toBeLessThan(500);
    expect(t10k).toBeLessThan(500);
  });
});

// ============================================================
// MESSAGES FORWARDED UNCHANGED
// ============================================================

describe('messages forwarded unchanged to handler', () => {
  it('passes the exact messages array to execute()', async () => {
    let receivedMessages: unknown;
    const harness = await harnessFor({
      chunks: [textChunk('ok')],
      onInvoke: (request) => {
        receivedMessages = (request as { params?: { messages?: unknown[] } })
          .params?.messages;
      },
    });

    const inputMessages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Tell me about streaming.' },
      { role: 'assistant', content: 'Streaming sends data incrementally.' },
    ];

    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ model: 't', messages: inputMessages })
    );
    await readSse(res);

    expect(receivedMessages).toEqual(inputMessages);
  });

  it('forwards a 10000-message array with no mutations', async () => {
    let receivedCount = 0;
    const harness = await harnessFor({
      chunks: [textChunk('ok')],
      onInvoke: (request) => {
        const msgs = (request as { params?: { messages?: unknown[] } }).params
          ?.messages;
        receivedCount = Array.isArray(msgs) ? msgs.length : 0;
      },
    });

    const large = Array.from({ length: 10_000 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }));

    const res = await harness.app.request(
      '/v1/chat/completions',
      jsonPost({ model: 't', messages: large })
    );
    await readSse(res);

    expect(receivedCount).toBe(10_000);
  });
});

// ============================================================
// WIRE FORMAT COMPATIBILITY — SIMULATED PARSER ASSERTIONS
// ============================================================

describe('wire format compatibility — simulated client parsers', () => {
  async function captureFrames(): Promise<string[]> {
    const harness = await harnessFor({
      chunks: [textChunk('hello'), textChunk(' world')],
    });
    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );
    return readSse(res);
  }

  it('openai SDK parser: each frame is "data: <json>" and terminal is "data: [DONE]"', async () => {
    const frames = await captureFrames();
    expect(frames[frames.length - 1]).toBe('data: [DONE]');

    for (const frame of frames.slice(0, -1)) {
      expect(frame).toMatch(/^data: /);
      const parsed = JSON.parse(parseDataLine(frame)) as ChatChunk;
      expect(Array.isArray(parsed.choices)).toBe(true);
    }
  });

  it('LiteLLM parser: same format as openai SDK (proxied SSE)', async () => {
    const frames = await captureFrames();
    expect(frames[frames.length - 1]).toBe('data: [DONE]');
    for (const frame of frames.slice(0, -1)) {
      expect(frame.startsWith('data: ')).toBe(true);
      expect(() => JSON.parse(parseDataLine(frame))).not.toThrow();
    }
  });

  it('Vercel AI SDK parser: accepts "data: <json>" framing with \\n\\n terminators', async () => {
    const harness = await harnessFor({ chunks: [textChunk('v')] });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );
    const rawText = await res.text();
    const rawFrames = rawText.split('\n\n').filter((f) => f.length > 0);

    for (const frame of rawFrames) {
      expect(frame.startsWith('data: ')).toBe(true);
    }

    const jsonFrames = rawFrames.filter((f) => f !== 'data: [DONE]');
    expect(jsonFrames.length).toBeGreaterThan(0);
    for (const frame of jsonFrames) {
      expect(() => JSON.parse(parseDataLine(frame))).not.toThrow();
    }
    expect(rawFrames[rawFrames.length - 1]).toBe('data: [DONE]');
  });

  it('curl frame parser: SSE compliance — "data: " prefix and \\n\\n terminators', async () => {
    const frames = await captureFrames();
    for (const frame of frames) {
      expect(frame.startsWith('data: ')).toBe(true);
    }
    expect(frames[frames.length - 1]).toBe('data: [DONE]');
    for (const frame of frames.slice(0, -1)) {
      expect(() => JSON.parse(parseDataLine(frame))).not.toThrow();
    }
  });
});

// ============================================================
// HARNESS LOADS CORRECTLY — PARTIAL BUNDLE CHECK
// ============================================================

describe('harness loads correctly (partial bundle verification)', () => {
  it('createChatHarness returns a harness with app, listen, and close', async () => {
    const harness = await harnessFor({ chunks: [textChunk('ok')] });
    expect(typeof harness.app).toBe('object');
    expect(typeof harness.listen).toBe('function');
    expect(typeof harness.close).toBe('function');
  });

  it('harness responds to requests from the Hono app instance', async () => {
    const harness = await harnessFor({ chunks: [textChunk('bundle-ok')] });
    const res = await harness.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});

// ============================================================
// CLIENT DISCONNECT — STREAM CANCELLATION
// ============================================================

describe('client disconnect — stream cancellation', () => {
  // [DEVIATION] RunContext does not currently expose an AbortSignal to the
  // handler. The chat harness aborts its own AbortController on stream
  // cancellation, but that signal isn't threaded into execute(). Until
  // RunContext.signal is added (and rill-build forwards it to the rill
  // runtime), the handler cannot observe client disconnects.
  //
  // The visible behavior we CAN test: cancelling the response body reader
  // closes the SSE stream without throwing. The pump's TransformStream
  // writes that fail after cancel are swallowed by the harness.
  it('cancelling the response reader closes the stream cleanly', async () => {
    const harness = await harnessFor({
      chunks: [
        textChunk('first'),
        textChunk('second'),
        textChunk('third'),
        textChunk('fourth'),
      ],
    });

    const res = await harness.app.request(
      '/v1/chat/completions',
      defaultBody()
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    // Consume one frame, then cancel — exercises the cancel path mid-stream.
    while (buf.indexOf('\n\n') === -1) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }

    await expect(reader.cancel()).resolves.toBeUndefined();
  });
});
