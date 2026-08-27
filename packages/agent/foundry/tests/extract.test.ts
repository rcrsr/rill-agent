import { describe, expect, it } from 'vitest';
import { extractInput } from '../src/extract.js';
import { InputError } from '../src/errors.js';

// ============================================================
// MALFORMED ARRAY ITEM SHAPES
// ============================================================

describe('extractInput — malformed input array items', () => {
  it('throws InputError (not a TypeError/500) for [null]', () => {
    expect(() => extractInput([null])).toThrow(InputError);
  });

  it('throws InputError (not a TypeError/500) for [{}]', () => {
    expect(() => extractInput([{}])).toThrow(InputError);
  });

  it('throws InputError (not a TypeError/500) when a message content field is a number', () => {
    const input = [{ type: 'message', role: 'user', content: 42 }];
    expect(() => extractInput(input)).toThrow(InputError);
  });

  it('throws InputError for a content array with a malformed part', () => {
    const input = [
      { type: 'message', role: 'user', content: [{ type: 'input_text' }] },
    ];
    expect(() => extractInput(input)).toThrow(InputError);
  });
});

// ============================================================
// VALID PATHS UNCHANGED
// ============================================================

describe('extractInput — valid paths remain unaffected by shape guarding', () => {
  it('still extracts a plain string input', () => {
    const result = extractInput('hello world');
    expect(result.params['input']).toBe('hello world');
  });

  it('still extracts the last user message from a well-formed array', () => {
    const input = [
      { type: 'message', role: 'user', content: 'first' },
      { type: 'message', role: 'user', content: 'second' },
    ];
    const result = extractInput(input);
    expect(result.params['input']).toBe('second');
  });

  it('still concatenates well-formed input_text content parts', () => {
    const input = [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'hello ' },
          { type: 'input_text', text: 'world' },
        ],
      },
    ];
    const result = extractInput(input);
    expect(result.params['input']).toBe('hello world');
  });

  it('still routes a well-formed function_call_output to its targetAgent', () => {
    const input = [
      {
        type: 'function_call',
        call_id: 'call_001',
        name: 'my-handler',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_001',
        output: '{"result":"done"}',
      },
    ];
    const result = extractInput(input);
    expect(result.targetAgent).toBe('my-handler');
  });
});
