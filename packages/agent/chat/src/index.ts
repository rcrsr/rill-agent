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
  ChatDelta,
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
import { createChatHarness } from './harness.js';

const HARNESS_NAME = '@rcrsr/rill-agent-chat';

/**
 * Default export consumed by the rill CLI (`rill install --replace`,
 * `rill run`) when this package is declared as a bundle harness. `serve`
 * assembles a router from the bundle's compiled packages and hosts it over the
 * OpenAI-compatible chat harness on `config.port` (default 3000).
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
      const server = createChatHarness(router, { port });
      await server.listen(port);
      ctx.logger.info(`[${HARNESS_NAME}] listening on :${port}`);
      return server;
    }),
};

export default harness;
