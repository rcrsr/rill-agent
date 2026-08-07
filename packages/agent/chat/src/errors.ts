// ============================================================
// ERROR CLASSES
// ============================================================

/**
 * Error thrown at factory time when the default agent route is enabled but
 * the default agent is missing, or its declared signature is not
 * chat-eligible. Not mapped to an HTTP status; indicates misconfiguration at
 * startup.
 */
export class ChatSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatSignatureError';
  }
}

/**
 * Error thrown when a buffered ChatChunk source carries an in-band error
 * signal (`finish_reason: 'error'` or a populated `error` field). The
 * message is handler-emitted application content, not internal exception
 * detail, so callers may surface it to the client as-is.
 */
export class ChatChunkError extends Error {
  /** HTTP status code for this error. */
  readonly statusCode: 500;

  constructor(message: string) {
    super(message);
    this.name = 'ChatChunkError';
    this.statusCode = 500;
  }
}
