import { describe, expect, it } from 'vitest';
import { extractInput } from '../src/extract.js';
import { InputError } from '../src/errors.js';

// ============================================================
// EXTRACT INPUT TESTS
// ============================================================

describe('extractInput', () => {
  // AC-1: string input → {params: {input: "..."}}
  it('returns params.input for plain string input', () => {
    const result = extractInput('hello world');
    expect(result.params['input']).toBe('hello world');
    expect(result.targetAgent).toBeUndefined();
  });

  // AC-2: message array extracts last user message text
  it('extracts last user message text from message array', () => {
    const input = [
      { type: 'message', role: 'user', content: 'first' },
      { type: 'message', role: 'user', content: 'second' },
    ];
    const result = extractInput(input);
    expect(result.params['input']).toBe('second');
  });

  // AC-3: structured content parts concatenates input_text parts
  it('concatenates input_text content parts from user message', () => {
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

  // AC-4: function_call_output routes to named handler via targetAgent
  it('routes function_call_output to named handler via targetAgent', () => {
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
    const toolResults = result.params['tool_results'] as Array<{
      call_id: string;
      output: string;
    }>;
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.call_id).toBe('call_001');
    expect(toolResults[0]!.output).toBe('{"result":"done"}');
  });

  // AC-30, EC-3: missing input field → InputError
  it('throws InputError when input is undefined', () => {
    expect(() => extractInput(undefined)).toThrow(InputError);
  });

  it('throws InputError when input is null', () => {
    expect(() => extractInput(null)).toThrow(InputError);
  });

  // AC-43, EC-3: empty string input → InputError
  it('throws InputError for empty string input', () => {
    expect(() => extractInput('')).toThrow(InputError);
  });

  it('throws InputError for whitespace-only string input', () => {
    expect(() => extractInput('   ')).toThrow(InputError);
  });

  // AC-44, EC-3: array with no actionable items → InputError
  it('throws InputError for array with no user messages or function calls', () => {
    const input = [{ type: 'message', role: 'assistant', content: 'hi' }];
    expect(() => extractInput(input)).toThrow(InputError);
  });

  it('throws InputError for empty array', () => {
    expect(() => extractInput([])).toThrow(InputError);
  });

  // EC-3: function_call_output without paired function_call → InputError
  it('throws InputError for function_call_output with no paired function_call', () => {
    const input = [
      {
        type: 'function_call_output',
        call_id: 'orphan_001',
        output: 'result',
      },
    ];
    expect(() => extractInput(input)).toThrow(InputError);
    expect(() => extractInput(input)).toThrow(
      'function_call_output missing paired function_call'
    );
  });
});
