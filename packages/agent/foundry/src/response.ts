import type { AgentRouter, RunResponse } from '@rcrsr/rill-agent';
import { generateId } from './id.js';
import type {
  ErrorResponse,
  FoundryResponse,
  FoundryToolDefinition,
  JSONSchemaObject,
  JSONSchemaProperty,
} from './types.js';

// ============================================================
// RESULT COERCION
// ============================================================

/**
 * Coerce a RunResponse result to a string.
 * - string → passthrough
 * - number | boolean → String()
 * - object (non-null) → JSON.stringify()
 * - null | undefined → empty string
 */
function coerceResult(result: unknown): string {
  if (result === null || result === undefined) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }
  return JSON.stringify(result);
}

// ============================================================
// SYNC RESPONSE BUILDER
// ============================================================

/**
 * Build a synchronous FoundryResponse from a RunResponse.
 *
 * State mapping: 'completed' → 'completed', 'error' → 'failed'.
 * Result is coerced to string; errors are encoded in the response body.
 */
export function buildSyncResponse(
  result: RunResponse,
  responseId: string
): FoundryResponse {
  const status = result.state === 'completed' ? 'completed' : 'failed';
  const text = coerceResult(result.result);
  const msgId = generateId('msg_');

  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    output: [
      {
        id: msgId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'text',
            text,
            annotations: [],
          },
        ],
      },
    ],
    error: status === 'failed' ? { code: 'SERVER_ERROR', message: text } : null,
    metadata: {},
    temperature: 0,
    top_p: 0,
    user: '',
  };
}

// ============================================================
// GENERIC ERROR MESSAGES
// ============================================================

const GENERIC_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: 'Invalid request',
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Rate limited',
  SERVER_ERROR: 'Internal server error',
};

const FALLBACK_MESSAGE = 'An error occurred';

// ============================================================
// ERROR RESPONSE BUILDER
// ============================================================

/**
 * Build a non-streaming JSON error response body.
 *
 * When debug is true, the original message is passed through verbatim.
 * When debug is false or absent, a generic message is returned based on
 * the error code per IR-10 (FOUNDRY_AGENT_DEBUG_ERRORS=false behavior).
 */
export function buildErrorResponse(
  code: string,
  message: string,
  debug?: boolean
): ErrorResponse {
  const safeMessage = debug
    ? message
    : (GENERIC_MESSAGES[code] ?? FALLBACK_MESSAGE);
  return {
    error: { code, message: safeMessage },
  };
}

// ============================================================
// TOOL DEFINITION GENERATOR
// ============================================================

/**
 * Map a rill param type string to a JSON Schema type string.
 * Falls back to 'string' for unrecognized types.
 */
function mapParamType(rillType: string): string {
  switch (rillType) {
    case 'number':
    case 'integer':
      return rillType;
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

/**
 * Generate Foundry tool definitions from the default agent's handler descriptions.
 *
 * Only the default agent's handlers are exposed (AC-21).
 * Returns an empty array when describe() returns null.
 */
export function generateToolDefinitions(
  router: AgentRouter
): FoundryToolDefinition[] {
  const defaultAgent = router.defaultAgent();
  const description = router.describe(defaultAgent);

  if (description === null) {
    return [];
  }

  const properties: Record<string, JSONSchemaProperty> = {};
  const required: string[] = [];

  for (const param of description.params) {
    const property: JSONSchemaProperty = {
      type: mapParamType(param.type),
      ...(param.description !== undefined
        ? { description: param.description }
        : {}),
      ...(param.defaultValue !== undefined
        ? { default: param.defaultValue }
        : {}),
    };
    properties[param.name] = property;
    if (param.required) {
      required.push(param.name);
    }
  }

  const parameters: JSONSchemaObject = {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  return [
    {
      type: 'function',
      name: description.name,
      description: description.description ?? '',
      parameters,
      strict: true,
    },
  ];
}
