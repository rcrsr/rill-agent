import { describe, it, expect } from 'vitest';
import type { AgentHandler, HandlerDescription } from '@rcrsr/rill-agent';
import { inspectChatHandler } from '../src/eligibility.js';
import { makeChatHandler } from './_fixtures.js';

/**
 * Build a handler whose only customization is the describe() result. Used to
 * isolate the eligibility check from execute() behavior.
 */
function handlerWithDescribe(
  description: HandlerDescription | null
): AgentHandler {
  return {
    describe: () => description,
    init: async () => undefined,
    execute: async () => ({ state: 'completed' as const, result: null }),
    dispose: async () => undefined,
  };
}

const CANONICAL_CHUNK_TYPE =
  'dict(choices: list(dict(delta: dict(role: string, content: string), finish_reason: string)))';

describe('inspectChatHandler — chat-eligible signature', () => {
  it('accepts the canonical chat signature', () => {
    const result = inspectChatHandler(makeChatHandler());
    expect(result.eligible).toBe(true);
  });

  it('accepts any resolution type on the stream return', () => {
    const result = inspectChatHandler(
      makeChatHandler({ returnType: `stream(${CANONICAL_CHUNK_TYPE}):number` })
    );
    expect(result.eligible).toBe(true);
  });

  it('accepts a stream return with no resolution suffix', () => {
    const result = inspectChatHandler(
      makeChatHandler({ returnType: `stream(${CANONICAL_CHUNK_TYPE})` })
    );
    expect(result.eligible).toBe(true);
  });
});

describe('inspectChatHandler — describe() rejections', () => {
  it('rejects when describe() returns null', () => {
    const result = inspectChatHandler(handlerWithDescribe(null));
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('describe() returned null');
    }
  });

  it('rejects when params is empty', () => {
    const result = inspectChatHandler(makeChatHandler({ params: [] }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('exactly one param');
    }
  });

  it('rejects when there are too many params', () => {
    const result = inspectChatHandler(
      makeChatHandler({
        params: [
          {
            name: 'messages',
            type: 'list(dict(role: string, content: string))',
            required: true,
          },
          { name: 'extra', type: 'string', required: true },
        ],
      })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('exactly one param');
    }
  });

  it('rejects when the param name is not "messages"', () => {
    const result = inspectChatHandler(
      makeChatHandler({
        params: [
          {
            name: 'history',
            type: 'list(dict(role: string, content: string))',
            required: true,
          },
        ],
      })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('"messages"');
      expect(result.reason).toContain('history');
    }
  });

  it('rejects when the messages param is optional', () => {
    const result = inspectChatHandler(
      makeChatHandler({
        params: [
          {
            name: 'messages',
            type: 'list(dict(role: string, content: string))',
            required: false,
          },
        ],
      })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('required');
    }
  });

  it('rejects when the messages type is the bare "list"', () => {
    const result = inspectChatHandler(
      makeChatHandler({
        params: [{ name: 'messages', type: 'list', required: true }],
      })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain(
        'list(dict(role: string, content: string))'
      );
      expect(result.reason).toContain('"list"');
    }
  });

  it('rejects when the messages type is a different parameterization', () => {
    const result = inspectChatHandler(
      makeChatHandler({
        params: [{ name: 'messages', type: 'list(string)', required: true }],
      })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('list(string)');
    }
  });
});

describe('inspectChatHandler — return type rejections', () => {
  it('rejects when describe() omits the returnType field', () => {
    const result = inspectChatHandler(makeChatHandler({ returnType: '' }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('returnType');
    }
  });

  it('rejects a non-stream return type', () => {
    const result = inspectChatHandler(
      makeChatHandler({ returnType: 'string' })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('stream(');
      expect(result.reason).toContain('"string"');
    }
  });

  it('rejects a stream of the wrong chunk type', () => {
    const result = inspectChatHandler(
      makeChatHandler({ returnType: 'stream(dict):string' })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain(CANONICAL_CHUNK_TYPE);
      expect(result.reason).toContain('"dict"');
    }
  });

  it('rejects a stream whose chunk dict is missing the choices field', () => {
    const result = inspectChatHandler(
      makeChatHandler({
        returnType:
          'stream(dict(delta: dict(role: string, content: string))):string',
      })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain(CANONICAL_CHUNK_TYPE);
    }
  });

  it('rejects a stream return type with unbalanced parens', () => {
    const result = inspectChatHandler(
      makeChatHandler({ returnType: 'stream(dict(choices: list(' })
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('stream(<chunk>)');
    }
  });
});

describe('inspectChatHandler — purity', () => {
  it('does not invoke execute() during inspection', async () => {
    let called = false;
    const handler = makeChatHandler({
      onInvoke: () => {
        called = true;
      },
    });
    inspectChatHandler(handler);
    expect(called).toBe(false);
  });
});
