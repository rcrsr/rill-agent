// ============================================================
// ERROR CLASSES
// ============================================================

/**
 * Error thrown by the router when a requested agent name does not resolve
 * to a registered handler. Structured so `routerErrorToStatus` can classify
 * it by field rather than message substring, which survives errors crossing
 * a realm boundary (e.g. VM contexts) where `instanceof` would not hold.
 */
export class AgentNotFoundError extends Error {
  /** HTTP status code for this error. */
  readonly statusCode: 404;
  /** Duck-typed discriminant, stable across realms. */
  readonly code: 'AGENT_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'AgentNotFoundError';
    this.statusCode = 404;
    this.code = 'AGENT_NOT_FOUND';
  }
}
