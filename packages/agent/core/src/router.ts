import type {
  AgentManifest,
  AgentRouter,
  HandlerDescription,
  RunRequest,
  RunResponse,
} from './types.js';

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
  const ahiResolver = async (
    agentName: string,
    request: RunRequest
  ): Promise<RunResponse> => {
    return run(agentName, request);
  };

  // Step 3: Initialize all agents concurrently
  await Promise.all(
    Array.from(manifest.agents.values()).map((handler) =>
      handler.init({
        globalVars: options?.globalVars,
        ahiResolver,
      })
    )
  );

  // Step 4: Build router
  async function run(
    agentName: string,
    request: RunRequest
  ): Promise<RunResponse> {
    const resolvedName = agentName === '' ? manifest.defaultAgent : agentName;
    const handler = manifest.agents.get(resolvedName);
    if (handler === undefined) {
      const available = Array.from(manifest.agents.keys()).join(', ');
      throw new Error(
        `Agent "${resolvedName}" not found. Available: ${available}`
      );
    }
    const normalized: RunRequest = {
      ...request,
      params: request.params ?? {},
    };
    return handler.execute(normalized);
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
    for (const handler of manifest.agents.values()) {
      await handler.dispose();
    }
  }

  return {
    run,
    describe,
    agents,
    defaultAgent: getDefaultAgent,
    dispose,
  };
}
