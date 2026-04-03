import type {
  ScriptNode,
  RuntimeContext,
  RillValue,
  ApplicationCallable,
} from '@rcrsr/rill';
import type { AgentCard } from './card.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Result object returned by extension factories.
 * Contains application callables keyed by function name,
 * with optional lifecycle hooks.
 *
 * Defined locally because @rcrsr/rill v0.18.0 moved to a resolver-based
 * extension model. This shape preserves the pre-v0.18.0 prefixed-function
 * approach used throughout this codebase.
 */
export type ExtensionResult = Record<string, ApplicationCallable> & {
  dispose?: () => void | Promise<void>;
  suspend?: () => unknown;
  restore?: (state: unknown) => void;
};

/**
 * An extension whose config contains @{VAR} placeholders that must be
 * resolved at runtime before the extension can be instantiated.
 */
export interface DeferredExtensionEntry {
  readonly mountAlias: string;
  readonly module: object;
  readonly manifest: object;
  readonly configTemplate: Record<string, unknown>;
  readonly requiredVars: readonly string[];
}

/**
 * A context value whose template contains @{VAR} placeholders that must
 * be resolved at runtime before the value can be used.
 */
export interface DeferredContextEntry {
  readonly key: string;
  readonly template: string;
  readonly requiredVars: readonly string[];
}

/**
 * A fully composed agent ready for execution.
 */
export interface ComposedAgent {
  readonly context: RuntimeContext;
  readonly ast: ScriptNode;
  readonly modules: Record<string, Record<string, RillValue>>;
  dispose(): Promise<void>;
  readonly card: AgentCard;
  readonly extensions: Record<string, ExtensionResult>;
  readonly deferredExtensions: readonly DeferredExtensionEntry[];
  readonly deferredContext: readonly DeferredContextEntry[];
  readonly runtimeVariables: readonly string[];
}
