import { describe, expect, it } from 'vitest';
import { createFoundryStreamResponse } from '../src/stream.js';

// ============================================================
// SSE PARSING HELPERS
// ============================================================

interface SseEvent {
  event: string | undefined;
  data: string | undefined;
}

function parseSseText(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = text.split('\n\n').filter((b) => b.trim() !== '');
  for (const block of blocks) {
    const lines = block.split('\n');
    let event: string | undefined;
    let data: string | undefined;
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice('data:'.length).trim();
      }
    }
    if (event !== undefined || data !== undefined) {
      events.push({ event, data });
    }
  }
  return events;
}

// ============================================================
// STREAMING TESTS
// ============================================================

describe('createFoundryStreamResponse', () => {
  it('emits minimal event sequence for resultPromise path', async () => {
    const res = createFoundryStreamResponse('resp_test', {
      resultPromise: Promise.resolve('hello world'),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    const events = parseSseText(text);
    const eventNames = events
      .map((e) => e.event)
      .filter((e): e is string => e !== undefined);

    // Only delta, done, completed — no envelope events.
    expect(eventNames).toEqual([
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.completed',
    ]);

    // Verify sequence_number increments.
    const seqNums = events.map((e) => {
      const parsed = JSON.parse(e.data ?? '{}') as {
        sequence_number?: number;
      };
      return parsed.sequence_number;
    });
    expect(seqNums).toEqual([0, 1, 2, 3]);

    // Verify delta content (word-by-word split).
    const deltas = events
      .filter((e) => e.event === 'response.output_text.delta')
      .map((e) => (JSON.parse(e.data ?? '{}') as { delta: string }).delta);
    expect(deltas).toEqual(['hello ', 'world']);
  });

  it('emits real-time delta events for async chunks', async () => {
    async function* chunks(): AsyncIterable<string> {
      yield 'Hello ';
      yield 'from ';
      yield 'chunks';
    }

    const res = createFoundryStreamResponse('resp_chunks', {
      chunks: chunks(),
    });

    const text = await res.text();
    const events = parseSseText(text);
    const eventNames = events
      .map((e) => e.event)
      .filter((e): e is string => e !== undefined);

    // One delta per chunk, then done + completed.
    expect(eventNames).toEqual([
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.completed',
    ]);

    // Verify each chunk maps to one delta.
    const deltas = events
      .filter((e) => e.event === 'response.output_text.delta')
      .map((e) => (JSON.parse(e.data ?? '{}') as { delta: string }).delta);
    expect(deltas).toEqual(['Hello ', 'from ', 'chunks']);

    // Verify done event has full text.
    const doneEvent = events.find(
      (e) => e.event === 'response.output_text.done'
    );
    const doneData = JSON.parse(doneEvent?.data ?? '{}') as { text: string };
    expect(doneData.text).toBe('Hello from chunks');
  });

  it('emits minimal completed response object', async () => {
    const res = createFoundryStreamResponse('resp_min', {
      resultPromise: Promise.resolve('test'),
    });

    const text = await res.text();
    const events = parseSseText(text);
    const completedEvent = events.find((e) => e.event === 'response.completed');
    const data = JSON.parse(completedEvent?.data ?? '{}') as {
      response: Record<string, unknown>;
    };

    // Only object, id, status, created_at, output — no metadata, temperature, etc.
    expect(data.response['object']).toBe('response');
    expect(data.response['id']).toBe('resp_min');
    expect(data.response['status']).toBe('completed');
    expect(data.response['created_at']).toBeTypeOf('number');
    expect(data.response['output']).toEqual([]);
    expect(data.response['metadata']).toBeUndefined();
    expect(data.response['temperature']).toBeUndefined();
  });

  it('emits error event when resultPromise rejects', async () => {
    const errors: unknown[] = [];
    const res = createFoundryStreamResponse('resp_err', {
      resultPromise: Promise.reject(new Error('agent failure')),
      onError: (err) => errors.push(err),
    });

    const text = await res.text();
    const events = parseSseText(text);
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();

    const errorData = JSON.parse(errorEvent?.data ?? '{}') as {
      type: string;
      code: string;
      message: string;
      param: string;
    };
    expect(errorData.type).toBe('error');
    expect(errorData.code).toBe('SERVER_ERROR');
    expect(errorData.message).toBe('agent failure');
    expect(errorData.param).toBe('');
    expect(errors).toHaveLength(1);
  });

  it('emits error event when chunks iterable throws', async () => {
    async function* failingChunks(): AsyncIterable<string> {
      yield 'partial';
      throw new Error('chunk failure');
    }

    const errors: unknown[] = [];
    const res = createFoundryStreamResponse('resp_cerr', {
      chunks: failingChunks(),
      onError: (err) => errors.push(err),
    });

    const text = await res.text();
    const events = parseSseText(text);

    // Should have at least one delta then an error.
    const deltaEvent = events.find(
      (e) => e.event === 'response.output_text.delta'
    );
    expect(deltaEvent).toBeDefined();

    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();
    const errorData = JSON.parse(errorEvent?.data ?? '{}') as {
      message: string;
    };
    expect(errorData.message).toBe('chunk failure');
    expect(errors).toHaveLength(1);
  });

  it('emits empty completion when no resultPromise or chunks provided', async () => {
    const res = createFoundryStreamResponse('resp_empty', {});

    const text = await res.text();
    const events = parseSseText(text);
    const eventNames = events
      .map((e) => e.event)
      .filter((e): e is string => e !== undefined);

    expect(eventNames).toEqual([
      'response.output_text.done',
      'response.completed',
    ]);

    const doneData = JSON.parse(
      events.find((e) => e.event === 'response.output_text.done')?.data ?? '{}'
    ) as { text: string };
    expect(doneData.text).toBe('');
  });
});
