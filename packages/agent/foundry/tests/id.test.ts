import { describe, it, expect } from 'vitest';
import { createIdGenerator, generateId } from '../src/id.js';

// ============================================================
// HELPERS
// ============================================================

const ALPHANUMERIC = /^[A-Za-z0-9]+$/;

function partitionKey(id: string): string | null {
  const idx = id.indexOf('_');
  if (idx === -1) return null;
  const segment = id.slice(idx + 1);
  if (segment.length < 18) return null;
  return segment.slice(0, 18);
}

// ============================================================
// TESTS
// ============================================================

describe('createIdGenerator', () => {
  describe('with no arguments', () => {
    it('generates a responseId starting with resp_', () => {
      const gen = createIdGenerator();
      expect(gen.responseId.startsWith('resp_')).toBe(true);
    });

    it('generates a responseId with alphanumeric entropy only', () => {
      const gen = createIdGenerator();
      const entropyPart = gen.responseId.slice('resp_'.length);
      expect(ALPHANUMERIC.test(entropyPart)).toBe(true);
    });
  });

  describe('with an existing responseId', () => {
    it('preserves the provided responseId', () => {
      const existingId = 'resp_abcdefghijklmnopqrstuvwxyz123456789012';
      const gen = createIdGenerator(existingId);
      expect(gen.responseId).toBe(existingId);
    });
  });

  describe('generateMessageId', () => {
    it('returns an ID starting with msg_', () => {
      const gen = createIdGenerator();
      const msgId = gen.generateMessageId();
      expect(msgId.startsWith('msg_')).toBe(true);
    });

    it('returns an ID with alphanumeric-only characters after the prefix', () => {
      const gen = createIdGenerator();
      const msgId = gen.generateMessageId();
      const afterPrefix = msgId.slice('msg_'.length);
      expect(ALPHANUMERIC.test(afterPrefix)).toBe(true);
    });
  });

  describe('partition key correlation', () => {
    it('IDs from the same generator share the same partition key segment', () => {
      const gen = createIdGenerator();
      const msgId1 = gen.generateMessageId();
      const msgId2 = gen.generateMessageId();
      const funcId = gen.generateFunctionCallId();

      const pkResp = partitionKey(gen.responseId);
      const pkMsg1 = partitionKey(msgId1);
      const pkMsg2 = partitionKey(msgId2);
      const pkFunc = partitionKey(funcId);

      expect(pkResp).not.toBeNull();
      expect(pkMsg1).toBe(pkResp);
      expect(pkMsg2).toBe(pkResp);
      expect(pkFunc).toBe(pkResp);
    });

    it('uses conversationId partition key when provided', () => {
      const conversationId = 'conv_AbCdEfGhIjKlMnOpQr123456789012345';
      const gen = createIdGenerator(undefined, conversationId);
      const msgId = gen.generateMessageId();
      const pkMsg = partitionKey(msgId);
      const pkConv = partitionKey(conversationId);
      expect(pkMsg).toBe(pkConv);
    });

    it('falls back to responseId partition key when conversationId is absent', () => {
      const responseId = 'resp_XyZaBcDeFgHiJkLmNo123456789012345';
      const gen = createIdGenerator(responseId);
      const msgId = gen.generateMessageId();
      const pkMsg = partitionKey(msgId);
      const pkResp = partitionKey(responseId);
      expect(pkMsg).toBe(pkResp);
    });
  });

  describe('entropy', () => {
    it('uses only alphanumeric characters [A-Za-z0-9]', () => {
      const gen = createIdGenerator();
      for (let i = 0; i < 20; i++) {
        const id = gen.generateMessageId();
        const afterPrefix = id.slice('msg_'.length);
        expect(ALPHANUMERIC.test(afterPrefix)).toBe(true);
      }
    });
  });
});

describe('generateId', () => {
  it('returns an ID with the given prefix', () => {
    const id = generateId('test_');
    expect(id.startsWith('test_')).toBe(true);
  });

  it('appends 32 alphanumeric characters after the prefix', () => {
    const prefix = 'pfx_';
    const id = generateId(prefix);
    const suffix = id.slice(prefix.length);
    expect(suffix).toHaveLength(32);
    expect(ALPHANUMERIC.test(suffix)).toBe(true);
  });
});
