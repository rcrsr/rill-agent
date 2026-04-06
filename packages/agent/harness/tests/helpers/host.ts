/**
 * Test utilities for AgentHost integration tests.
 *
 * Mirrors the pattern from packages/core/tests/helpers/runtime.ts.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAgent } from '@rcrsr/rill-agent-harness';
import type { ComposedAgent } from '../../src/index.js';
import type { AgentHost, AgentHostOptions } from '../../src/index.js';
import { createAgentHost } from '../../src/index.js';

// Absolute path to the simple-agent fixture directory — resolved once at
// module load. Using an absolute path ensures composeAgent() finds the
// rill-config.json regardless of process.cwd() at test time.
const SIMPLE_AGENT_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures/simple-agent'
);

// ============================================================
// MOCK COMPOSED AGENT
// ============================================================

/**
 * Returns a minimal ComposedAgent for testing by calling composeAgent()
 * with the simple-agent fixture directory (contains rill-config.json and
 * handler.rill with a no-op handler).
 */
export async function mockComposedAgent(): Promise<ComposedAgent> {
  return composeAgent(SIMPLE_AGENT_DIR, { config: {}, env: {} });
}

// ============================================================
// CREATE TEST HOST
// ============================================================

/**
 * Creates a fully initialized AgentHost in 'ready' state for testing.
 * createAgentHost() accepts a pre-composed agent; no init() call is needed.
 */
export async function createTestHost(
  options?: AgentHostOptions
): Promise<AgentHost> {
  return createAgentHost(await mockComposedAgent(), options);
}
