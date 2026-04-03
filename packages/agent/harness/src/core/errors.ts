/**
 * Error types for rill-host.
 * Shared by all modules in the package.
 */

import type { HostErrorPhase } from './types.js';

// ============================================================
// BASE ERROR
// ============================================================

/**
 * Base error for all AgentHost failures.
 * Extends Error with structured phase context and optional cause.
 */
export class AgentHostError extends Error {
  /** Lifecycle phase where the error occurred. */
  readonly phase: HostErrorPhase;

  /**
   * Present when this error represents missing required runtime variables (EC-7).
   * Contains the list of variable names absent from runtimeConfig.
   */
  readonly requiredVars?: readonly string[] | undefined;

  /**
   * Present when a deferred extension factory threw during request init (EC-8).
   * Contains the mount alias of the failing extension.
   */
  readonly extensionAlias?: string | undefined;

  constructor(
    message: string,
    phase: HostErrorPhase,
    cause?: unknown,
    extras?: {
      requiredVars?: readonly string[] | undefined;
      extensionAlias?: string | undefined;
    }
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'AgentHostError';
    this.phase = phase;
    if (extras?.requiredVars !== undefined) {
      this.requiredVars = extras.requiredVars;
    }
    if (extras?.extensionAlias !== undefined) {
      this.extensionAlias = extras.extensionAlias;
    }
  }
}
