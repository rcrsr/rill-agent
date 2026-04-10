import { InputError } from './errors.js';
import type { InputItem, ContentPart } from './types.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Result of extractInput: the extracted params and an optional target agent.
 */
export interface ExtractedInput {
  readonly params: Record<string, unknown>;
  readonly targetAgent?: string | undefined;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Concatenate text from all `input_text` ContentPart entries.
 */
function concatenateTextParts(parts: ContentPart[]): string {
  return parts
    .filter((p) => p.type === 'input_text')
    .map((p) => p.text)
    .join('');
}

/**
 * Extract text from a user message content field (string or ContentPart[]).
 */
function extractUserText(content: string | ContentPart[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return concatenateTextParts(content);
}

/**
 * Find the last user message item in an input array and return its text.
 * Returns undefined when no user message is present.
 */
function findLastUserText(items: InputItem[]): string | undefined {
  let text: string | undefined;
  for (const item of items) {
    if (item.type === 'message' && item.role === 'user') {
      text = extractUserText(item.content);
    }
  }
  return text;
}

/**
 * Find all function_call_output items paired with their function_call.
 * Returns extracted params and target agent name.
 * Throws InputError when a function_call_output has no paired function_call.
 */
function extractFunctionCallOutputs(items: InputItem[]): ExtractedInput {
  // Build a map of call_id → handler name from function_call items.
  const callMap = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'function_call') {
      callMap.set(item.call_id, item.name);
    }
  }

  // Collect all function_call_output items.
  const outputs = items.filter(
    (item): item is Extract<InputItem, { type: 'function_call_output' }> =>
      item.type === 'function_call_output'
  );

  // Resolve each output to a handler name and validate pairing.
  let targetAgent: string | undefined;
  const toolResults: Array<{ call_id: string; output: string }> = [];

  for (const output of outputs) {
    const handlerName = callMap.get(output.call_id);
    if (handlerName === undefined) {
      throw new InputError('function_call_output missing paired function_call');
    }
    // Use the first resolved handler name as the target agent.
    if (targetAgent === undefined) {
      targetAgent = handlerName;
    }
    toolResults.push({ call_id: output.call_id, output: output.output });
  }

  return {
    params: { tool_results: toolResults },
    targetAgent,
  };
}

// ============================================================
// EXTRACT INPUT
// ============================================================

/**
 * Extract normalized params and optional target agent from a polymorphic input.
 *
 * Variants:
 * - string → { params: { input: string } }
 * - array with user message → { params: { input: lastUserText } }
 * - array with function_call_output → { params: { tool_results: [...] }, targetAgent }
 *
 * Throws InputError for missing, empty, or unactionable input.
 */
export function extractInput(input: unknown): ExtractedInput {
  if (input === undefined || input === null || input === '') {
    throw new InputError('Missing required field: input');
  }

  if (typeof input === 'string') {
    if (input.trim() === '') {
      throw new InputError('Missing required field: input');
    }
    return { params: { input } };
  }

  if (!Array.isArray(input) || input.length === 0) {
    throw new InputError('Missing required field: input');
  }

  const items = input as InputItem[];

  // Check for function_call_output items first.
  const hasFunctionCallOutput = items.some(
    (item) => item.type === 'function_call_output'
  );
  if (hasFunctionCallOutput) {
    return extractFunctionCallOutputs(items);
  }

  // Look for a user message.
  const userText = findLastUserText(items);
  if (userText !== undefined) {
    return { params: { input: userText } };
  }

  throw new InputError('No actionable input items found');
}
