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

export type { IdGenerator } from './id.js';
export { createIdGenerator, generateId } from './id.js';

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
// TELEMETRY
// ============================================================

export type { TelemetryOptions } from './telemetry.js';
export { initTelemetry, getTracer, shutdownTelemetry } from './telemetry.js';

// ============================================================
// FOUNDRY HARNESS
// ============================================================

export type { FoundryHarness } from './harness.js';
export { createFoundryHarness } from './harness.js';

// ============================================================
// RILL CLI HARNESS ADAPTER
// ============================================================

import { createRouter, assembleManifest } from '@rcrsr/rill-agent';
import {
  runRillServe,
  readHarnessPort,
  assertCompiledHandlers,
  type RillHarness,
} from '@rcrsr/rill-agent-hono-kit';
import { createFoundryHarness } from './harness.js';

const HARNESS_NAME = '@rcrsr/rill-agent-foundry';

/**
 * Default export consumed by the rill CLI (`rill install --replace`,
 * `rill run`) when this package is declared as a bundle harness. `serve`
 * assembles a router from the bundle's compiled packages and hosts it over the
 * Foundry Responses harness on `config.port` (default 3000).
 */
const harness: RillHarness = {
  name: HARNESS_NAME,
  postBuild: async (ctx) => {
    assertCompiledHandlers(ctx);
  },
  serve: (ctx) =>
    runRillServe(ctx, async (entries) => {
      const router = await createRouter(await assembleManifest(entries));
      const port = readHarnessPort(ctx.config, 3000);
      const server = createFoundryHarness(router, { port });
      await server.listen();
      ctx.logger.info(`[${HARNESS_NAME}] listening on :${port}`);
      return server;
    }),
};

export default harness;
