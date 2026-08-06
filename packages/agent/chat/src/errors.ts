// ============================================================
// ERROR CLASSES
// ============================================================

/**
 * Error thrown when the inbound messages array fails validation.
 * Maps to HTTP 400.
 */
export class ChatValidationError extends Error {
  /** HTTP status code for this error. */
  readonly statusCode: 400;

  constructor(message: string) {
    super(message);
    this.name = 'ChatValidationError';
    this.statusCode = 400;
  }
}

/**
 * Error thrown at factory time when a required handler lacks a chat() method.
 * Not mapped to an HTTP status; indicates misconfiguration at startup.
 */
export class ChatSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatSignatureError';
  }
}

/**
 * Error thrown when a chat request targets an unknown agent name,
 * or when chat routes are disabled.
 * Maps to HTTP 404.
 */
export class ChatNotFoundError extends Error {
  /** HTTP status code for this error. */
  readonly statusCode: 404;

  constructor(message: string) {
    super(message);
    this.name = 'ChatNotFoundError';
    this.statusCode = 404;
  }
}
