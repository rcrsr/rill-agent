import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  streamFoundryResponse,
  createFoundryStreamResponse,
} from '../src/stream.js';

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
// ASYNC ITERABLE HELPERS
// ============================================================

async function* makeChunks(
  chunks: Array<{ value?: unknown }>
): AsyncIterable<{ value?: unknown }> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function* makeThrowingIterable(): AsyncIterable<{ value?: unknown }> {
  yield { value: 'partial' };
  throw new Error('stream failure');
}

// ============================================================
// STREAMING TESTS
// ============================================================

describe('streamFoundryResponse', () => {
  // AC-11: stream produces SSE with lifecycle events in correct sequence
  it('emits lifecycle events in correct sequence with sequence_number', async () => {
    const app = new Hono();

    app.post('/stream', (c) => {
      const iterable = makeChunks([{ value: 'hello' }, { value: ' world' }]);
      return streamFoundryResponse(c, 'resp_test', iterable, {});
    });

    const res = await app.request('/stream', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    const events = parseSseText(text);
    const eventNames = events
      .map((e) => e.event)
      .filter((e): e is string => e !== undefined);

    const expectedSequence = [
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ];

    expect(eventNames).toEqual(expectedSequence);

    // Verify every event has a monotonically increasing sequence_number
    const seqNums = events
      .map((e) => {
        const parsed = JSON.parse(e.data ?? '{}') as {
          sequence_number?: number;
        };
        return parsed.sequence_number;
      })
      .filter((n): n is number => n !== undefined);
    expect(seqNums).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Verify delta events carry text content
    const deltaEvents = events.filter(
      (e) => e.event === 'response.output_text.delta'
    );
    const deltas = deltaEvents.map((e) => {
      const parsed = JSON.parse(e.data ?? '{}') as { delta: string };
      return parsed.delta;
    });
    expect(deltas).toEqual(['hello', ' world']);

    // Verify completed event carries full response object with all required fields
    const completedEvent = events.find((e) => e.event === 'response.completed');
    const completedData = JSON.parse(completedEvent?.data ?? '{}') as {
      sequence_number: number;
      response: {
        status: string;
        error: null;
        incomplete_details: null;
        instructions: null;
        metadata: Record<string, string>;
        temperature: number;
        top_p: number;
        user: string;
        parallel_tool_calls: boolean;
        conversation: null;
        output: Array<{ content: Array<{ text: string }> }>;
      };
    };
    expect(completedData.response.status).toBe('completed');
    expect(completedData.response.metadata).toHaveProperty(
      'foundry_agents_metadata'
    );
    // foundry_agents_metadata must be an object, not a double-encoded JSON string
    expect(
      typeof completedData.response.metadata['foundry_agents_metadata']
    ).toBe('object');
    expect(completedData.response.output[0]?.content[0]?.text).toBe(
      'hello world'
    );
  });

  // AC-11: response.created event contains correct responseId and required fields
  it('includes responseId and required fields in response.created event', async () => {
    const app = new Hono();

    app.post('/stream', (c) => {
      return streamFoundryResponse(c, 'resp_abc123', makeChunks([]), {});
    });

    const res = await app.request('/stream', { method: 'POST' });
    const text = await res.text();
    const events = parseSseText(text);

    const createdEvent = events.find((e) => e.event === 'response.created');
    const data = JSON.parse(createdEvent?.data ?? '{}') as {
      sequence_number: number;
      response: { id: string; parallel_tool_calls: boolean };
    };
    expect(data.response.id).toBe('resp_abc123');
    expect(data.sequence_number).toBe(0);
  });

  // AC-34, EC-5: handler throws during stream → emits event: error with SDK format
  it('emits error SSE event with code/message/param when iterable throws', async () => {
    const app = new Hono();
    const errors: unknown[] = [];

    app.post('/stream', (c) => {
      return streamFoundryResponse(c, 'resp_err', makeThrowingIterable(), {
        onError: (err) => {
          errors.push(err);
        },
      });
    });

    const res = await app.request('/stream', { method: 'POST' });
    const text = await res.text();
    const events = parseSseText(text);

    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();

    const errorData = JSON.parse(errorEvent?.data ?? '{}') as {
      type: string;
      sequence_number: number;
      code: string;
      message: string;
      param: string;
    };
    expect(errorData.type).toBe('error');
    expect(typeof errorData.sequence_number).toBe('number');
    expect(errorData.code).toBe('SERVER_ERROR');
    expect(errorData.message).toBe('stream failure');
    expect(errorData.param).toBe('');
  });

  // AC-11: createFoundryStreamResponse emits full event sequence for promise-based path
  it('createFoundryStreamResponse emits full lifecycle event sequence', async () => {
    const resultPromise = Promise.resolve('hello world');
    const res = createFoundryStreamResponse('resp_promise', { resultPromise });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    const events = parseSseText(text);

    // Filter out empty-delta heartbeat events before asserting sequence.
    // Heartbeats are response.output_text.delta events with delta === ''.
    const nonHeartbeatNames = events
      .filter((e) => {
        if (e.event !== 'response.output_text.delta') return true;
        const parsed = JSON.parse(e.data ?? '{}') as { delta: string };
        return parsed.delta !== '';
      })
      .map((e) => e.event)
      .filter((e): e is string => e !== undefined);

    const expectedSequence = [
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ];

    expect(nonHeartbeatNames).toEqual(expectedSequence);

    // Verify the delta carries the resolved text
    const deltaEvent = events.find(
      (e) =>
        e.event === 'response.output_text.delta' &&
        (JSON.parse(e.data ?? '{}') as { delta: string }).delta !== ''
    );
    const deltaData = JSON.parse(deltaEvent?.data ?? '{}') as { delta: string };
    expect(deltaData.delta).toBe('hello world');

    // Verify completed event carries the full text in output
    const completedEvent = events.find((e) => e.event === 'response.completed');
    const completedData = JSON.parse(completedEvent?.data ?? '{}') as {
      response: {
        status: string;
        output: Array<{ content: Array<{ text: string }> }>;
      };
    };
    expect(completedData.response.status).toBe('completed');
    expect(completedData.response.output[0]?.content[0]?.text).toBe(
      'hello world'
    );
  });

  // AC-42: SSE keep-alive comment after 15s inactivity
  it.skip('emits keep-alive SSE comment after 15s inactivity', async () => {
    // Would require real 15s delay or intercepting the stream write channel
  });

  // Cancellation: reader cancel must not crash the process
  it('does not throw when stream is cancelled during iteration', async () => {
    let resolve: () => void;
    const started = new Promise<void>((r) => {
      resolve = r;
    });

    async function* slowIterable(): AsyncIterable<{ value?: unknown }> {
      resolve!();
      yield { value: 'partial' };
      // Hang indefinitely to simulate a long-running agent
      await new Promise<void>(() => {});
    }

    const app = new Hono();
    app.post('/stream', (c) => {
      return streamFoundryResponse(c, 'resp_cancel', slowIterable(), {});
    });

    const res = await app.request('/stream', { method: 'POST' });
    expect(res.status).toBe(200);

    // Wait for the stream to start iterating
    await started;

    // Cancel the reader (simulates client disconnect)
    const reader = res.body!.getReader();
    // Read initial SSE preamble events
    await reader.read();
    await reader.cancel('client disconnected');

    // If the cancel handler works, no uncaught exception is thrown.
    // Give the event loop a tick to surface any uncaught errors.
    await new Promise((r) => setTimeout(r, 10));
  });
});
