import { AgentNotFoundError } from './errors.js';
import type {
  AgentHandler,
  AgentManifest,
  AgentRouter,
  HandlerDescription,
  RunContext,
  RunRequest,
  RunResponse,
} from './types.js';

/**
 * Dispose every handler, even if some fail. Uses `Promise.allSettled` so a
 * single failing `dispose()` cannot prevent the rest from being attempted.
 * Throws an `AggregateError` wrapping every rejection if any handler failed.
 */
async function disposeAll(handlers: Iterable<AgentHandler>): Promise<void> {
  const results = await Promise.allSettled(
    Array.from(handlers, (handler) => handler.dispose())
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason as unknown),
      `${failures.length} handler(s) failed to dispose`
    );
  }
}

/**
 * Create a router from a loaded manifest.
 *
 * 1. Calls describe() on each agent (type info before init)
 * 2. Creates AHI resolver
 * 3. Calls init({ globalVars, ahiResolver }) on each agent
 * 4. Returns AgentRouter ready for execute() calls
 */
export async function createRouter(
  manifest: AgentManifest,
  options?: { globalVars?: Record<string, string> | undefined }
): Promise<AgentRouter> {
  const descriptions = new Map<string, HandlerDescription | null>();

  // Step 1: Gather descriptions (before init)
  for (const [name, handler] of manifest.agents) {
    descriptions.set(name, handler.describe());
  }

  // Step 2: Create AHI resolver (references the router's own run function)
  // Note: AHI calls are agent-to-agent and do not carry the caller's session
  // variables, so context is intentionally not forwarded here.
  const ahiResolver = async (
    agentName: string,
    request: RunRequest
  ): Promise<RunResponse> => {
    return run(agentName, request);
  };

  // Step 3: Initialize all agents concurrently. On any rejection, dispose
  // the handlers whose init() already succeeded before rethrowing, so a
  // partially-initialized router never leaks resources.
  const handlerEntries = Array.from(manifest.agents.values());
  const initResults = await Promise.allSettled(
    handlerEntries.map((handler) =>
      handler.init({
        globalVars: options?.globalVars,
        ahiResolver,
      })
    )
  );
  const initFailures: unknown[] = [];
  const initSucceeded: AgentHandler[] = [];
  initResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      initFailures.push(result.reason);
    } else {
      initSucceeded.push(handlerEntries[index]!);
    }
  });
  if (initFailures.length > 0) {
    await disposeAll(initSucceeded).catch(() => undefined);
    throw initFailures.length === 1
      ? initFailures[0]
      : new AggregateError(
          initFailures,
          `${initFailures.length} handler(s) failed to init`
        );
  }

  // Step 4: Build router
  async function run(
    agentName: string,
    request: RunRequest,
    context?: RunContext
  ): Promise<RunResponse> {
    const resolvedName = agentName === '' ? manifest.defaultAgent : agentName;
    const handler = manifest.agents.get(resolvedName);
    if (handler === undefined) {
      const available = Array.from(manifest.agents.keys()).join(', ');
      throw new AgentNotFoundError(
        `Agent "${resolvedName}" not found. Available: ${available}`
      );
    }
    const normalized: RunRequest = {
      ...request,
      params: request.params ?? {},
    };
    return handler.execute(normalized, context);
  }

  function describe(agentName: string): HandlerDescription | null {
    const resolvedName = agentName === '' ? manifest.defaultAgent : agentName;
    return descriptions.get(resolvedName) ?? null;
  }

  function agents(): string[] {
    return Array.from(manifest.agents.keys());
  }

  function getDefaultAgent(): string {
    return manifest.defaultAgent;
  }

  async function dispose(): Promise<void> {
    await disposeAll(manifest.agents.values());
  }

  return {
    manifest,
    run,
    describe,
    agents,
    defaultAgent: getDefaultAgent,
    dispose,
  };
}
