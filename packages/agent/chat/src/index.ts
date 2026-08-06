// ============================================================
// FACTORY
// ============================================================

export { createChatHarness } from './harness.js';

// ============================================================
// TYPES
// ============================================================

export type {
  AhiResolver,
  ChatChunk,
  ChatCtx,
  ChatDelta,
  ChatHandler,
  ChatHarness,
  ChatHarnessOptions,
  ChatMessage,
  ChatRequest,
  UsageMetadata,
} from './types.js';

// ============================================================
// ERRORS
// ============================================================

export {
  ChatNotFoundError,
  ChatSignatureError,
  ChatValidationError,
} from './errors.js';

// ============================================================
// INTERNALS (exported for testing)
// ============================================================

export { inspectChatHandler } from './eligibility.js';
export { validateMessages } from './validate.js';
