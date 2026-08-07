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
