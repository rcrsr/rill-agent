import { describe, it, expect } from 'vitest';
import { validateMessages } from '../src/validate.js';

// ============================================================
// NON-ARRAY INPUT
// ============================================================

describe('validateMessages — non-array input', () => {
  it('returns "messages must be an array" for a string', () => {
    const result = validateMessages('hello');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('messages must be an array');
    }
  });

  it('returns "messages must be an array" for a plain object', () => {
    const result = validateMessages({ role: 'user', content: 'hi' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('messages must be an array');
    }
  });

  it('returns "messages must be an array" for null', () => {
    const result = validateMessages(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('messages must be an array');
    }
  });
});

// ============================================================
// EMPTY ARRAY
// ============================================================

describe('validateMessages — empty array', () => {
  it('returns "messages must be a non-empty array" for []', () => {
    const result = validateMessages([]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('messages must be a non-empty array');
    }
  });
});

// ============================================================
// INVALID ROLE
// ============================================================

describe('validateMessages — invalid role', () => {
  it('returns indexed role error for a message with an unrecognized role', () => {
    const result = validateMessages([{ role: 'bot', content: 'hello' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(
        'messages[0].role must be one of: system, user, assistant'
      );
    }
  });

  it('returns the correct index in the role error for the second message', () => {
    const result = validateMessages([
      { role: 'user', content: 'hi' },
      { role: 'unknown', content: 'oops' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(
        'messages[1].role must be one of: system, user, assistant'
      );
    }
  });
});

// ============================================================
// NON-STRING CONTENT
// ============================================================

describe('validateMessages — non-string content', () => {
  it('returns indexed content error when content is a number', () => {
    const result = validateMessages([{ role: 'user', content: 42 }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('messages[0].content must be a string');
    }
  });

  it('returns indexed content error when content is absent', () => {
    const result = validateMessages([{ role: 'assistant' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('messages[0].content must be a string');
    }
  });
});

// ============================================================
// VALID SINGLE-ENTRY ARRAY
// ============================================================

describe('validateMessages — valid input', () => {
  it('returns valid:true with the message for a single well-formed entry', () => {
    const result = validateMessages([{ role: 'user', content: 'hi' }]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({ role: 'user', content: 'hi' });
    }
  });

  it('returns valid:true for all three allowed roles', () => {
    const input = [
      { role: 'system', content: 'You are a bot.' },
      { role: 'user', content: 'Hello.' },
      { role: 'assistant', content: 'Hi there.' },
    ];
    const result = validateMessages(input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.messages).toHaveLength(3);
    }
  });
});

// ============================================================
// LARGE ARRAY
// ============================================================

describe('validateMessages — large array', () => {
  it('passes validation for a 10000-entry array', () => {
    const large = Array.from({ length: 10_000 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i}`,
    }));
    const result = validateMessages(large);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.messages).toHaveLength(10_000);
    }
  });
});

// ============================================================
// MAX_MESSAGES BOUNDARY
// ============================================================

describe('validateMessages — MAX_MESSAGES boundary', () => {
  it('passes validation for exactly 10000 messages', () => {
    const atLimit = Array.from({ length: 10_000 }, () => ({
      role: 'user',
      content: 'hi',
    }));
    const result = validateMessages(atLimit);
    expect(result.valid).toBe(true);
  });

  it('rejects an array of 10001 messages with a cap error', () => {
    const overLimit = Array.from({ length: 10_001 }, () => ({
      role: 'user',
      content: 'hi',
    }));
    const result = validateMessages(overLimit);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('messages must not exceed 10000 items');
    }
  });
});

// ============================================================
// MAX_CONTENT_LENGTH BOUNDARY
// ============================================================

describe('validateMessages — MAX_CONTENT_LENGTH boundary', () => {
  it('passes validation for content at exactly 32000 characters', () => {
    const result = validateMessages([
      { role: 'user', content: 'a'.repeat(32_000) },
    ]);
    expect(result.valid).toBe(true);
  });

  it('rejects content over 32000 characters with an indexed error', () => {
    const result = validateMessages([
      { role: 'user', content: 'a'.repeat(32_001) },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe(
        'messages[0].content must not exceed 32000 characters'
      );
    }
  });
});
