// ============================================================
// TYPES
// ============================================================

export type {
  ContentPart,
  CreateResponse,
  ErrorResponse,
  FoundryHarnessOptions,
  FoundryMetrics,
  FoundryResponse,
  FoundryToolDefinition,
  InputItem,
  FunctionCallItem,
  FunctionCallOutputItem,
  JSONSchemaObject,
  JSONSchemaProperty,
  OutputContentPart,
  OutputItem,
  StreamErrorEvent,
  ToolDefinition,
  UserMessageItem,
} from './types.js';

// ============================================================
// ERRORS
// ============================================================

export { CapacityError, CredentialError, InputError } from './errors.js';

// ============================================================
// ID GENERATION
// ============================================================

export { generateId } from './id.js';

// ============================================================
// INPUT EXTRACTION
// ============================================================

export type { ExtractedInput } from './extract.js';
export { extractInput } from './extract.js';

// ============================================================
// SESSION MANAGER
// ============================================================

export type { SessionManager } from './session.js';
export { createSessionManager } from './session.js';

// ============================================================
// RESPONSE BUILDERS
// ============================================================

export {
  buildErrorResponse,
  buildSyncResponse,
  generateToolDefinitions,
} from './response.js';

// ============================================================
// SSE STREAM EMITTER
// ============================================================

export { streamFoundryResponse } from './stream.js';

// ============================================================
// CONVERSATIONS CLIENT
// ============================================================

export type { ConversationsClient } from './conversations.js';
export {
  createConversationsClient,
  PersistenceError,
} from './conversations.js';

// ============================================================
// FOUNDRY HARNESS
// ============================================================

export type { FoundryHarness } from './harness.js';
export { createFoundryHarness } from './harness.js';
