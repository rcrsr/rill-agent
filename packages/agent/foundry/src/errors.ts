// ============================================================
// ERROR CLASSES
// ============================================================

/**
 * Error thrown when the request input is missing, empty, or unparseable.
 * Maps to HTTP 400. Error code: INVALID_REQUEST.
 */
export class InputError extends Error {
  /** HTTP status code for this error. */
  readonly statusCode: 400;

  constructor(message: string) {
    super(message);
    this.name = 'InputError';
    this.statusCode = 400;
  }
}

/**
 * Error thrown when managed identity credential acquisition fails at startup.
 * Triggers a non-zero process exit.
 */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

/**
 * Error thrown when the session pool is at maximum capacity.
 * Maps to HTTP 429. Error code: RATE_LIMITED.
 */
export class CapacityError extends Error {
  /** HTTP status code for this error. */
  readonly statusCode: 429;

  constructor(max: number) {
    super(`Maximum concurrent sessions (${max}) reached`);
    this.name = 'CapacityError';
    this.statusCode = 429;
  }
}
