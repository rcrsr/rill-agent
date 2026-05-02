/**
 * AHI Extension Factory
 *
 * Provides agent-to-agent HTTP invocation via the Agent Host Interface (AHI).
 * Static URL mode: agents are configured with explicit endpoint URLs.
 */

import type {
  ApplicationCallable,
  ExtensionConfigSchema,
  ExtensionFactoryCtx,
  ExtensionManifest,
  RillValue,
} from '@rcrsr/rill';
import { isDict, RuntimeError, callable } from '@rcrsr/rill';

// ============================================================
// TYPES
// ============================================================

/**
 * Result object returned by extension factories. Contains application
 * callables keyed by function name with optional lifecycle hooks.
 */
export type ExtensionResult = Record<string, ApplicationCallable> & {
  dispose?: () => void | Promise<void>;
  suspend?: () => unknown;
  restore?: (state: unknown) => void;
};

/** Minimal run request for in-process agent invocation. */
interface InProcessRunRequest {
  readonly params?: Record<string, unknown> | undefined;
  readonly correlationId?: string | undefined;
  readonly timeout?: number | undefined;
  readonly trigger?:
    | string
    | {
        readonly type: 'agent';
        readonly agentName: string;
        readonly sessionId: string;
      };
}

/** Minimal run response for in-process agent invocation. */
interface InProcessRunResponse {
  readonly state: 'running' | 'completed' | 'failed';
  readonly result?: RillValue | undefined;
}

/**
 * Interface for an in-process agent host accepted by createInProcessFunction.
 * Implemented by AgentHost from @rcrsr/rill-host. Defined here locally to
 * avoid a cross-package dependency.
 */
export interface InProcessRunner {
  runForAgent(
    agentName: string,
    input: InProcessRunRequest
  ): Promise<InProcessRunResponse>;
}

/** Configuration for a single AHI agent endpoint */
export interface AhiAgentConfig {
  /** Resolved endpoint URL (after env substitution) */
  url: string;
}

/** AHI extension configuration (static URL mode) */
export interface AhiExtensionConfig {
  /** Agent name to endpoint config map */
  agents: Record<string, AhiAgentConfig>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number | undefined;
}

// ============================================================
// HELPERS
// ============================================================

/** ENV_VAR_PATTERN matches ${VAR_NAME} substitution tokens */
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Resolve all ${VAR} tokens in a URL string using process.env.
 * Throws synchronously if any referenced variable is unset.
 */
function resolveEnvVars(url: string): string {
  return url.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`AHI: environment variable ${varName} is not set`);
    }
    return value;
  });
}

/**
 * Convert the first rill argument to a JSON-serializable params object.
 * If args[0] is a dict, spread it into a plain object.
 * Otherwise return an empty object.
 */
function extractParams(args: RillValue[]): Record<string, RillValue> {
  const first = args[0];
  if (first !== undefined && isDict(first)) {
    return { ...first };
  }
  return {};
}

// ============================================================
// SHARED HTTP INVOCATION
// ============================================================

/**
 * Perform the HTTP POST to a resolved agent endpoint.
 *
 * @param agentUrl - Resolved base URL of the agent
 * @param agentTimeout - Effective timeout in ms (0 = unlimited)
 * @param args - Rill call arguments
 * @param ctx - Rill call context (metadata forwarded as headers)
 * @param inFlight - Set of active AbortControllers for dispose tracking
 * @returns Rill value from downstream agent
 */
async function invokeAgent(
  agentUrl: string,
  agentTimeout: number,
  args: RillValue[],
  ctx: { readonly metadata?: Record<string, string> | undefined },
  inFlight: Set<AbortController>
): Promise<RillValue> {
  const params = extractParams(args);
  const metadata = ctx.metadata ?? {};

  // AC-5 / AC-22: forward remaining budget when it is less than the
  // configured default. Read timeoutDeadline set by host.ts / handler.ts.
  const deadlineRaw = metadata['timeoutDeadline'];
  const deadlineMs =
    deadlineRaw !== undefined ? parseInt(deadlineRaw, 10) : undefined;

  let effectiveTimeout = agentTimeout;
  if (deadlineMs !== undefined && !isNaN(deadlineMs)) {
    const remaining = deadlineMs - Date.now();
    // If deadline has already passed, send 1 ms (not 0, which means no timeout).
    // If remaining < configured default (or default is 0 = unlimited), use remaining.
    if (agentTimeout === 0 || remaining < agentTimeout) {
      effectiveTimeout = remaining > 0 ? remaining : 1;
    }
  }

  const body = JSON.stringify({
    params,
    trigger: {
      type: 'agent',
      agentName: metadata['agentName'] ?? '',
      sessionId: metadata['sessionId'] ?? '',
    },
    timeout: effectiveTimeout,
  });

  // Build AbortController only when a non-zero timeout is configured.
  // AC-21: timeout 0 means no deadline — skip AbortController entirely.
  let controller: AbortController | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  if (effectiveTimeout !== 0) {
    controller = new AbortController();
    timeoutHandle = setTimeout(() => {
      controller!.abort();
    }, effectiveTimeout);
  }

  // Track controller for dispose cancellation
  if (controller !== undefined) {
    inFlight.add(controller);
  }

  try {
    const response = await fetch(`${agentUrl}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': metadata['correlationId'] ?? '',
      },
      body,
      signal: controller?.signal ?? null,
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 400) {
        const text = await response.text();
        throw new RuntimeError('RILL-R027', `AHI: validation failed: ${text}`);
      }
      if (status === 404) {
        throw new RuntimeError('RILL-R028', 'AHI: agent unreachable');
      }
      if (status === 429) {
        throw new RuntimeError('RILL-R032', 'AHI: rate limited');
      }
      if (status === 500) {
        throw new RuntimeError('RILL-R029', 'AHI: downstream execution failed');
      }
      throw new RuntimeError(
        'RILL-R034',
        `AHI: downstream error: HTTP ${status}`
      );
    }

    const json = (await response.json()) as { result: RillValue };
    return json.result;
  } catch (err) {
    // Re-throw structured errors immediately
    if (err instanceof RuntimeError) {
      throw err;
    }
    // EC-7: AbortController signal fired → timeout exceeded
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RuntimeError('RILL-R030', 'AHI: timeout exceeded');
    }
    // EC-8: Network failure (DNS, connection refused)
    if (err instanceof TypeError) {
      throw new RuntimeError('RILL-R031', 'AHI: connection refused');
    }
    throw err;
  } finally {
    if (controller !== undefined) {
      inFlight.delete(controller);
    }
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create AHI extension for agent-to-agent HTTP invocation.
 *
 * Each agent name registers an `ahi::<name>` host function.
 *
 * @param config - AHI extension configuration
 * @returns ExtensionResult with one function per agent
 * @throws Error if any agent URL contains an unset env variable (EC-2)
 *
 * @example
 * ```typescript
 * const ahiExt = createAhiExtension({
 *   agents: {
 *     parser: { url: 'http://localhost:4001' },
 *   },
 * });
 * ```
 */
export function createAhiExtension(
  config: AhiExtensionConfig
): ExtensionResult {
  const { agents, timeout = 30000 } = config;

  // Static URL mode: validate and resolve env vars in each agent URL
  const resolvedAgents = new Map<string, { url: string }>();

  for (const [name, agentConfig] of Object.entries(agents)) {
    const resolvedUrl = resolveEnvVars(agentConfig.url);
    resolvedAgents.set(name, { url: resolvedUrl });
  }

  // ============================================================
  // IN-FLIGHT TRACKING (factory-level, shared across all agents)
  // ============================================================

  const inFlight = new Set<AbortController>();
  let disposed = false;

  // ============================================================
  // FUNCTION REGISTRATION
  // ============================================================

  const functions: Record<string, ApplicationCallable> = {};

  for (const [name, agent] of resolvedAgents) {
    // Capture agent state for this closure
    const agentUrl = agent.url;

    functions[name] = callable(((
      args: RillValue[],
      ctx: { readonly metadata?: Record<string, string> | undefined }
    ): Promise<RillValue> => {
      // AC-11: reject calls after dispose
      if (disposed) {
        throw new RuntimeError('RILL-R033', 'AHI: extension disposed');
      }
      return invokeAgent(agentUrl, timeout, args, ctx, inFlight);
    }) as unknown as Parameters<typeof callable>[0]);
  }

  // ============================================================
  // DISPOSE
  // ============================================================

  // AC-11: cancel all in-flight requests and block further calls
  const dispose = (): void => {
    disposed = true;
    for (const ctrl of inFlight) {
      ctrl.abort();
    }
    inFlight.clear();
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const result: ExtensionResult = { ...functions };
  result.dispose = dispose;

  return result;
}

// ============================================================
// CONFIG SCHEMA
// ============================================================
export const configSchema: ExtensionConfigSchema = {
  agents: { type: 'string' },
  timeout: { type: 'number' },
};

// ============================================================
// IN-PROCESS CALL
// ============================================================

/**
 * Create a CallableFn that invokes a target agent in-process via runner.
 *
 * IR-9: Calls runner.runForAgent() with caller trigger metadata and
 * propagated timeout deadline. Maps capacity errors to RILL-R032 and
 * failed state to RILL-R029.
 *
 * @param runner - In-process agent runner
 * @param targetAgentName - Name of the target agent to invoke
 * @param defaultTimeout - Default timeout in ms (0 = unlimited)
 */
function createInProcessCallFn(
  runner: InProcessRunner,
  targetAgentName: string,
  defaultTimeout: number
): (
  args: RillValue[],
  ctx: { readonly metadata?: Record<string, string> | undefined }
) => Promise<RillValue> {
  return async (
    args: RillValue[],
    ctx: { readonly metadata?: Record<string, string> | undefined }
  ): Promise<RillValue> => {
    const params = extractParams(args);
    const metadata = ctx.metadata ?? {};

    const callerAgentName = metadata['agentName'] ?? '';
    const callerSessionId = metadata['sessionId'] ?? '';
    const callerCorrelationId = metadata['correlationId'];

    // AC-5 / AC-22: propagate remaining budget when it is less than the
    // configured default. Mirror the same logic used in invokeAgent().
    const deadlineRaw = metadata['timeoutDeadline'];
    const deadlineMs =
      deadlineRaw !== undefined ? parseInt(deadlineRaw, 10) : undefined;

    let effectiveTimeout = defaultTimeout;
    if (deadlineMs !== undefined && !isNaN(deadlineMs)) {
      const remaining = deadlineMs - Date.now();
      if (defaultTimeout === 0 || remaining < defaultTimeout) {
        effectiveTimeout = remaining > 0 ? remaining : 1;
      }
    }

    let response: {
      state: 'running' | 'completed' | 'failed';
      result?: RillValue | undefined;
    };

    try {
      response = await runner.runForAgent(targetAgentName, {
        params,
        correlationId: callerCorrelationId,
        trigger: {
          type: 'agent',
          agentName: callerAgentName,
          sessionId: callerSessionId,
        },
        timeout: effectiveTimeout,
      });
    } catch (err) {
      // EC-12: capacity error from host → RILL-R032 rate limited
      // Duck-type check: ahi cannot import AgentHostError directly.
      if (
        err instanceof Error &&
        (('phase' in err &&
          (err as unknown as { phase: string }).phase === 'capacity') ||
          err.message.includes('capacity'))
      ) {
        throw new RuntimeError('RILL-R032', 'AHI: rate limited');
      }
      throw err;
    }

    // EC-13: downstream execution failed → RILL-R029
    if (response.state === 'failed') {
      throw new RuntimeError('RILL-R029', 'AHI: downstream execution failed');
    }

    return response.result ?? null;
  };
}

// ============================================================
// IN-PROCESS FUNCTION FACTORY
// ============================================================

/**
 * Create a HostFunctionDefinition for in-process AHI invocation.
 *
 * Used by bindHost() to register ahi::<name> functions that bypass HTTP
 * and call the agent directly.
 *
 * @param runner - In-process agent runner (InProcessRunner-compatible)
 * @param targetAgentName - Name of the target agent
 * @param timeout - Default request timeout in ms (0 = unlimited)
 * @returns HostFunctionDefinition ready for registration
 */
export function createInProcessFunction(
  runner: InProcessRunner,
  targetAgentName: string,
  timeout: number
): ApplicationCallable {
  return callable(
    createInProcessCallFn(
      runner,
      targetAgentName,
      timeout
    ) as unknown as Parameters<typeof callable>[0]
  );
}

// ============================================================
// EXTENSION MANIFEST
// ============================================================

/**
 * Standard extension manifest for @rcrsr/rill-agent-ext-ahi.
 * Wraps createAhiExtension so that loadProject() can validate the
 * bundle output config at build time (dry-run validation, AC-49).
 *
 * The factory accepts AhiExtensionConfig and returns the extension's
 * callable dict as the mounted RillValue.
 */
export const extensionManifest: ExtensionManifest = {
  factory: async (config: unknown, ctx: ExtensionFactoryCtx) => {
    ctx.registerErrorCode('RILL-R027', 'validation');
    ctx.registerErrorCode('RILL-R028', 'transport');
    ctx.registerErrorCode('RILL-R029', 'downstream');
    ctx.registerErrorCode('RILL-R030', 'timeout');
    ctx.registerErrorCode('RILL-R031', 'transport');
    ctx.registerErrorCode('RILL-R032', 'capacity');
    ctx.registerErrorCode('RILL-R033', 'lifecycle');
    ctx.registerErrorCode('RILL-R034', 'downstream');

    const result = createAhiExtension(config as AhiExtensionConfig);
    const { dispose, ...value } = result;

    if (dispose !== undefined) {
      if (ctx.signal.aborted) {
        dispose();
      } else {
        ctx.signal.addEventListener('abort', dispose, { once: true });
      }
    }

    return {
      value: value as unknown as RillValue,
      ...(dispose !== undefined ? { dispose } : {}),
    };
  },
  configSchema,
};
