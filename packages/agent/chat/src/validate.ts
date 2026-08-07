import type { ChatMessage } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const VALID_ROLES = ['system', 'user', 'assistant'] as const;

/** Maximum number of messages accepted per chat request. */
const MAX_MESSAGES = 10_000;

/** Maximum character length accepted for a single message's content. */
const MAX_CONTENT_LENGTH = 32_000;

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates that value is a non-empty array of well-formed ChatMessage objects.
 * Returns a discriminated union: success carries the narrowed ChatMessage array,
 * failure carries a human-readable error string.
 */
export function validateMessages(
  value: unknown
): { valid: true; messages: ChatMessage[] } | { valid: false; error: string } {
  if (!Array.isArray(value)) {
    return { valid: false, error: 'messages must be an array' };
  }

  if (value.length === 0) {
    return { valid: false, error: 'messages must be a non-empty array' };
  }

  if (value.length > MAX_MESSAGES) {
    return {
      valid: false,
      error: `messages must not exceed ${MAX_MESSAGES} items`,
    };
  }

  const messages: ChatMessage[] = [];

  for (let i = 0; i < value.length; i++) {
    const item = value[i] as unknown;

    if (
      typeof item !== 'object' ||
      item === null ||
      !('role' in item) ||
      !(VALID_ROLES as readonly unknown[]).includes(
        (item as Record<string, unknown>)['role']
      )
    ) {
      return {
        valid: false,
        error: `messages[${i}].role must be one of: system, user, assistant`,
      };
    }

    const record = item as Record<string, unknown>;

    if (typeof record['content'] !== 'string') {
      return {
        valid: false,
        error: `messages[${i}].content must be a string`,
      };
    }

    if (record['content'].length > MAX_CONTENT_LENGTH) {
      return {
        valid: false,
        error: `messages[${i}].content must not exceed ${MAX_CONTENT_LENGTH} characters`,
      };
    }

    messages.push({
      role: record['role'] as ChatMessage['role'],
      content: record['content'],
    });
  }

  return { valid: true, messages };
}
