export type {
  InputSchema,
  OutputSchema,
  AgentSkill,
  SlimHarnessAgent,
  SlimHarnessConfig,
} from './schema.js';

export {
  validateSlimHarness,
  structuralTypeToInputSchema,
  structuralTypeToOutputSchema,
} from './schema.js';

export type { ComposePhase, ManifestIssue } from './errors.js';
export { ComposeError, ManifestValidationError } from './errors.js';

export type { AgentCard, AgentCapabilities, AgentCardInput } from './card.js';
export { generateAgentCard } from './card.js';

export type {
  ComposedAgent,
  ExtensionResult,
  DeferredExtensionEntry,
  DeferredContextEntry,
} from './composed-agent.js';

export type { InterpolationResult, ConfigInterpolationResult } from './interpolate.js';
export { interpolateEnv, interpolateConfigDeep, validateDeferredScope } from './interpolate.js';

export type {
  RunRequest,
  RunResponse,
  HandlerContext,
  ComposedHandler,
  ComposedHandlerMap,
} from './handler.js';

export type {
  InProcessRunRequest,
  InProcessRunResponse,
  AgentRunner,
} from './runner.js';

export { checkTargetCompatibility } from './compat.js';

export type {
  AhiBinding,
  StdioRunMessage,
  StdioRunResult,
  StdioAhiRequest,
  StdioAhiResponse,
} from './protocol.js';
