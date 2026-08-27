/**
 * Duck-typed shape check for a structured router error, matched by field
 * rather than `instanceof` so classification survives errors crossing a
 * realm boundary (e.g. VM contexts) where prototype chains do not line up.
 */
function hasNotFoundCode(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'AGENT_NOT_FOUND'
  );
}

/**
 * Matches the router's legacy unstructured not-found message shape
 * (`Agent "<name>" not found. Available: <list>`). Scoped to that exact
 * shape, not a bare "not found" substring, so an unrelated error that
 * happens to mention "not found" is not misclassified as 404.
 */
const LEGACY_AGENT_NOT_FOUND_PATTERN = /^Agent ".*" not found\./;

export function routerErrorToStatus(err: unknown): 404 | 500 {
  if (hasNotFoundCode(err)) {
    return 404;
  }
  // Fallback for errors that predate the structured `code` field.
  const message = err instanceof Error ? err.message : String(err);
  if (LEGACY_AGENT_NOT_FOUND_PATTERN.test(message)) {
    return 404;
  }
  return 500;
}
