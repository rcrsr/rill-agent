import { randomBytes } from 'node:crypto';

// ============================================================
// TYPES
// ============================================================

export interface IdGenerator {
  readonly responseId: string;
  generateMessageId(): string;
  generateFunctionCallId(): string;
  generateFunctionOutputId(): string;
}

// ============================================================
// HELPERS
// ============================================================

const PARTITION_KEY_LENGTH = 18;
const ENTROPY_LENGTH = 32;

/**
 * Generate entropy of the given length using crypto-secure random bytes.
 * Base64-encodes the bytes and filters to alphanumeric only [A-Za-z0-9].
 * Retries until enough characters are collected.
 */
function generateEntropy(length: number): string {
  let result = '';
  while (result.length < length) {
    const bytes = randomBytes(Math.ceil(length * 1.5));
    result += bytes.toString('base64').replace(/[^A-Za-z0-9]/g, '');
  }
  return result.slice(0, length);
}

/**
 * Extract an 18-character partition key from a prefixed ID string.
 * The partition key is taken from the first 18 characters of the segment
 * after the first underscore. Returns null when the ID lacks the expected
 * format (no underscore or insufficient characters after it).
 */
function extractPartitionKey(id: string): string | null {
  const underscoreIdx = id.indexOf('_');
  if (underscoreIdx === -1) return null;
  const segment = id.slice(underscoreIdx + 1);
  if (segment.length < PARTITION_KEY_LENGTH) return null;
  return segment.slice(0, PARTITION_KEY_LENGTH);
}

/**
 * Produce a compliant Foundry ID.
 * Format: {prefix}_{partitionKey}{entropy}
 */
function buildId(prefix: string, partitionKey: string): string {
  const entropy = generateEntropy(ENTROPY_LENGTH);
  return `${prefix}_${partitionKey}${entropy}`;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create an IdGenerator scoped to a single request.
 *
 * Partition key extraction priority:
 *   1. conversationId (preferred for conversation-scoped routing)
 *   2. responseId (fallback for response-scoped routing)
 *   3. random 18-char key when neither has a valid format
 *
 * If responseId is not provided, one is generated with prefix `resp`.
 */
export function createIdGenerator(
  responseId?: string | undefined,
  conversationId?: string | undefined
): IdGenerator {
  const partitionKey =
    (conversationId !== undefined
      ? extractPartitionKey(conversationId)
      : null) ??
    (responseId !== undefined ? extractPartitionKey(responseId) : null) ??
    generateEntropy(PARTITION_KEY_LENGTH);

  const resolvedResponseId = responseId ?? buildId('resp', partitionKey);

  return {
    responseId: resolvedResponseId,
    generateMessageId: () => buildId('msg', partitionKey),
    generateFunctionCallId: () => buildId('func', partitionKey),
    generateFunctionOutputId: () => buildId('funcout', partitionKey),
  };
}

// ============================================================
// BACKWARD COMPAT
// ============================================================

/**
 * Generate a prefixed random ID using crypto-secure entropy.
 * Format: {prefix}{32 alphanumeric chars}
 *
 * Kept for backward compatibility with callers that do not need
 * partition-key correlation.
 */
export function generateId(prefix: string): string {
  return prefix + generateEntropy(ENTROPY_LENGTH);
}
