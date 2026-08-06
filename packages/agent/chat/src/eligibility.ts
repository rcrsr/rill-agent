import type { AgentHandler } from '@rcrsr/rill-agent';

/**
 * Canonical chat input type. The chat harness invokes handlers via
 * `execute({ params: { messages: [...] } })` where each message is a
 * `{role: string, content: string}` dict — the OpenAI Chat Completions input
 * shape, with the validated subset of roles (system/user/assistant) enforced
 * upstream by `validate.ts`.
 */
const EXPECTED_MESSAGES_TYPE = 'list(dict(role: string, content: string))';

/**
 * Canonical chat chunk type — the shape of each value the harness reads from
 * `context.onChunk`. Matches the OpenAI Chat Completions chunk minimum:
 * one `choices` entry with a `delta` (role + content) and a `finish_reason`.
 *
 * The harness fills in id/object/created/model on its way out to the wire,
 * so handlers don't need to declare them in the chunk type.
 */
const EXPECTED_CHUNK_TYPE =
  'dict(choices: list(dict(delta: dict(role: string, content: string), finish_reason: string)))';

/**
 * Pull the chunk type out of a `stream(<chunk>)` or `stream(<chunk>):<ret>`
 * annotation by matching paren depth. Returns null when the input is not
 * a stream annotation or the parens are unbalanced.
 */
function extractStreamChunkType(returnType: string): string | null {
  const prefix = 'stream(';
  if (!returnType.startsWith(prefix)) return null;
  let depth = 1;
  const start = prefix.length;
  for (let i = start; i < returnType.length; i++) {
    const c = returnType[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return returnType.slice(start, i);
      }
    }
  }
  return null;
}

/**
 * Chat eligibility validates the handler's declared signature via describe().
 *
 * The contract: a chat handler is a stream closure with the canonical chat
 * input shape and the canonical chat chunk shape. Concretely, the handler's
 * `describe()` must report:
 *   - exactly one required param named `messages` with type
 *     `list(dict(role: string, content: string))`;
 *   - a `returnType` of the form `stream(<EXPECTED_CHUNK_TYPE>)` or
 *     `stream(<EXPECTED_CHUNK_TYPE>):<resolution>` where the resolution type
 *     is unconstrained — the harness only consumes chunks via onChunk and
 *     leaves the closure free to resolve to a string, number, dict, etc.
 *
 * Any deviation in either the param shape or the chunk shape rejects the
 * handler at `createChatHarness()` time rather than failing on the first
 * request. Both fields are emitted by rill-build ≥ 0.19.6 (paired with
 * rill ≥ 0.19.3).
 */
export function inspectChatHandler(
  handler: AgentHandler
): { eligible: true } | { eligible: false; reason: string } {
  const description = handler.describe();
  if (description === null) {
    return {
      eligible: false,
      reason: 'handler.describe() returned null',
    } as const;
  }

  const params = description.params;
  if (params.length !== 1) {
    return {
      eligible: false,
      reason: `expected exactly one param "messages", got ${params.length}`,
    } as const;
  }

  const p = params[0];
  if (p === undefined) {
    return {
      eligible: false,
      reason: 'handler.describe() returned an empty params slot',
    } as const;
  }
  if (p.name !== 'messages') {
    return {
      eligible: false,
      reason: `expected param "messages", got "${p.name}"`,
    } as const;
  }
  if (!p.required) {
    return {
      eligible: false,
      reason: 'expected param "messages" to be required',
    } as const;
  }
  if (p.type !== EXPECTED_MESSAGES_TYPE) {
    return {
      eligible: false,
      reason: `expected param "messages" of type "${EXPECTED_MESSAGES_TYPE}", got "${p.type}"`,
    } as const;
  }

  if (description.returnType === undefined) {
    return {
      eligible: false,
      reason:
        'handler.describe() did not report a returnType (rebuild with rill-cli >= 0.19.6)',
    } as const;
  }

  const chunkType = extractStreamChunkType(description.returnType);
  if (chunkType === null) {
    return {
      eligible: false,
      reason: `expected return type "stream(<chunk>)" or "stream(<chunk>):<ret>", got "${description.returnType}"`,
    } as const;
  }
  if (chunkType !== EXPECTED_CHUNK_TYPE) {
    return {
      eligible: false,
      reason: `expected stream chunk type "${EXPECTED_CHUNK_TYPE}", got "${chunkType}"`,
    } as const;
  }

  return { eligible: true } as const;
}
