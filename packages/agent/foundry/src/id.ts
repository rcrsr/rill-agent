// ============================================================
// ID GENERATION
// ============================================================

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 24;

/**
 * Generate a prefixed random ID using alphanumeric characters.
 * Format: {prefix}{24 random chars}
 */
export function generateId(prefix: string): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ALPHABET.length);
    suffix += ALPHABET[idx] ?? 'a';
  }
  return prefix + suffix;
}
