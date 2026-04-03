import type {
  AgentSkill,
  InputSchema,
  OutputSchema,
} from './schema.js';

// ============================================================
// AGENT CARD TYPES
// ============================================================

/**
 * Transport capabilities declared by an agent.
 */
export interface AgentCapabilities {
  readonly streaming: boolean;
  readonly pushNotifications: boolean;
}

/**
 * A2A-compliant agent card describing identity, capabilities, and skills.
 */
export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly url: string;
  readonly capabilities: AgentCapabilities;
  readonly skills: readonly AgentSkill[];
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly input?: InputSchema | undefined;
  readonly output?: OutputSchema | undefined;
  readonly runtimeVariables: readonly string[];
}

/**
 * Input structure for card generation from handler introspection data.
 * Replaces AgentManifest as the parameter type after migration.
 */
export interface AgentCardInput {
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly skills?: AgentSkill[] | undefined;
  readonly deploy?: { port?: number | undefined; healthPath?: string | undefined } | undefined;
  readonly input?: InputSchema | undefined;
  readonly output?: OutputSchema | undefined;
  readonly runtimeVariables: readonly string[];
}

// ============================================================
// GENERATE AGENT CARD
// ============================================================

/**
 * Produces an A2A-compliant AgentCard from handler introspection data.
 *
 * Pure function — no I/O, no side effects.
 *
 * @param input - Handler introspection data
 * @returns A2A-compliant AgentCard
 */
export function generateAgentCard(input: AgentCardInput): AgentCard {
  const url =
    input.deploy?.port !== undefined
      ? `http://localhost:${input.deploy.port}`
      : '';

  return {
    name: input.name,
    description: input.description ?? '',
    version: input.version,
    url,
    capabilities: { streaming: false, pushNotifications: false },
    skills: input.skills ?? [],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    runtimeVariables: input.runtimeVariables,
    ...(input.input !== undefined ? { input: input.input } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
  };
}
