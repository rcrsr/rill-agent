# Agent Shared

*Shared types, validation, and card generation for rill agent packages*

`@rcrsr/rill-agent-shared` exports the types, validation functions, and error classes shared across `@rcrsr/rill-agent-harness`, `@rcrsr/rill-agent-bundle`, and `@rcrsr/rill-agent-run`. Import directly from this package when you need types or utilities without taking a dependency on a full runtime package.

## Exports

### Types

| Type | Description |
|------|-------------|
| `SlimHarnessConfig` | Validated harness.json configuration object |
| `SlimHarnessAgent` | Single agent entry within a slim harness config |
| `InputSchema` | Map of parameter names to `InputParamDescriptor` |
| `OutputSchema` | Output type descriptor with `type`, `description`, and optional `fields` |
| `AgentSkill` | Skill definition with `id`, `name`, `description`, and optional metadata |
| `AgentCard` | A2A-compliant agent capability card |
| `AgentCardInput` | Input to `generateAgentCard`; replaces `AgentManifest` after migration |
| `AgentCapabilities` | Flags for `streaming` and `pushNotifications` support |
| `ManifestIssue` | Single validation issue with `path`, `message`, and optional `line` |
| `ComposePhase` | Phase identifier: `'validation' \| 'resolution' \| 'compatibility' \| 'compilation' \| 'bundling' \| 'init'` |
| `AgentRunner` | Function type for executing a composed agent |
| `ComposedHandler` | Single composed agent handler function |
| `ComposedHandlerMap` | Map from agent name to `ComposedHandler` |
| `HandlerContext` | Execution context passed to a composed handler |
| `RunRequest` | Input to a `/run` invocation |
| `RunResponse` | Output from a `/run` invocation |
| `InProcessRunRequest` | Input for in-process agent invocation |
| `InProcessRunResponse` | Output from in-process agent invocation |
| `ComposedAgent` | A fully composed agent ready for execution |
| `ExtensionResult` | Result object returned by extension factories |
| `DeferredExtensionEntry` | Extension with `@{VAR}` placeholders; resolved per request |
| `DeferredContextEntry` | Context value with `@{VAR}` placeholders; resolved per request |
| `InterpolationResult` | Return type of `interpolateEnv` |
| `ConfigInterpolationResult` | Return type of `interpolateConfigDeep`; splits resolved from deferred keys |

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `validateSlimHarness` | `(json: unknown) => SlimHarnessConfig` | Validates raw JSON against the slim harness schema |
| `generateAgentCard` | `(input: AgentCardInput) => AgentCard` | Builds an A2A-compliant `AgentCard` from handler introspection data |
| `interpolateEnv` | `(value: string, env: Record<string, string \| undefined>) => InterpolationResult` | Substitutes `${VAR}` tokens; collects `@{VAR}` names in `deferred` |
| `interpolateConfigDeep` | `(config, env) => ConfigInterpolationResult` | Walks a nested config and interpolates all string values |
| `validateDeferredScope` | `(config: Record<string, unknown>) => readonly string[]` | Returns paths where `@{VAR}` appears outside allowed sections |
| `checkTargetCompatibility` | `(bundle, target: BuildTarget) => ManifestIssue[]` | Returns issues when the bundle does not meet platform constraints |
| `structuralTypeToInputSchema` | `(type: TypeStructure, params: RillParam[]) => InputSchema` | Converts a rill structural type to an `InputSchema` |
| `structuralTypeToOutputSchema` | `(type: TypeStructure) => OutputSchema` | Converts a rill structural type to an `OutputSchema` |

### Error Classes

| Class | Description |
|-------|-------------|
| `ComposeError` | Base error for all composition failures; carries a `phase: ComposePhase` field |
| `ManifestValidationError` | Extends `ComposeError`; carries an `issues: readonly ManifestIssue[]` field |

## Removed API (Migration Notes)

The following types and functions were present in earlier versions and have been removed as part of the rill-config migration. Code that used them must be updated to use the new API.

| Removed | Replacement |
|---------|-------------|
| `AgentManifest` | `AgentCardInput` for card generation; `rill-config.json` is the new manifest format |
| `HarnessManifest` | `SlimHarnessConfig` (validated from `harness.json`) |
| `HarnessAgentEntry` | `SlimHarnessAgent` |
| `ManifestExtension` | Removed; extensions are now declared in `rill-config.json` |
| `ManifestHostOptions` | Removed; host options come from `rill-config.json` `host` section |
| `ManifestDeployOptions` | Removed; deploy options come from `rill-config.json` `deploy` section |
| `EnvSource` | Removed; env loading is handled by `@rcrsr/rill-config` |
| `BuildTarget` | Still exported from `schema.ts` but not from package root |
| `validateManifest` | `validateSlimHarness` for harness.json; `composeAgent` reads rill-config.json directly |
| `validateHarnessManifest` | `validateSlimHarness` |
| `detectManifestType` | Removed; harness.json and rill-config.json are distinct files |
| `resolveExtensions` | Removed; extension loading is handled inside `composeAgent` |
| `extractConfigSchema` | Removed; config schema handling is internal to compose |
| `ResolvedExtension` | Removed from public API; resolution is internal to harness |
| `loadEnv` | Removed; env loading is handled by `@rcrsr/rill-config` |

## Usage Examples

### validateSlimHarness

```typescript
import { validateSlimHarness, ManifestValidationError } from '@rcrsr/rill-agent-shared';
import { readFileSync } from 'node:fs';

const json = JSON.parse(readFileSync('./harness.json', 'utf-8'));

try {
  const config = validateSlimHarness(json);
  console.log(`Harness with ${config.agents.length} agents`);
} catch (err) {
  if (err instanceof ManifestValidationError) {
    for (const issue of err.issues) {
      console.error(`${issue.path}: ${issue.message}`);
    }
  }
}
```

### generateAgentCard

```typescript
import { generateAgentCard } from '@rcrsr/rill-agent-shared';
import type { AgentCardInput } from '@rcrsr/rill-agent-shared';

const input: AgentCardInput = {
  name: 'my-agent',
  version: '1.0.0',
  description: 'Processes documents',
  runtimeVariables: ['TENANT_ID'],
  deploy: { port: 3000 },
};

const card = generateAgentCard(input);
console.log(card.url, card.runtimeVariables);
```

### interpolateEnv with deferred patterns

```typescript
import { interpolateEnv } from '@rcrsr/rill-agent-shared';

// ${VAR} is resolved from env; @{VAR} is preserved literally
const result = interpolateEnv(
  'Bearer ${API_TOKEN} for tenant @{TENANT_ID}',
  { API_TOKEN: 'secret' }
);

console.log(result.value);      // 'Bearer secret for tenant @{TENANT_ID}'
console.log(result.unresolved); // []
console.log(result.deferred);   // ['TENANT_ID']
```

### validateDeferredScope

```typescript
import { validateDeferredScope } from '@rcrsr/rill-agent-shared';

const config = {
  extensions: { config: { llm: { api_key: '@{LLM_KEY}' } } },
  host: { timeout: '@{BAD_PLACEMENT}' },
};

const violations = validateDeferredScope(config);
// violations: ['host.timeout'] — @{VAR} not allowed outside extensions.config and context.values
```

## Types Reference

### AgentCardInput

```typescript
interface AgentCardInput {
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly skills?: AgentSkill[] | undefined;
  readonly deploy?: {
    port?: number | undefined;
    healthPath?: string | undefined;
  } | undefined;
  readonly input?: InputSchema | undefined;
  readonly output?: OutputSchema | undefined;
  readonly runtimeVariables: readonly string[];
}
```

`runtimeVariables` lists the `@{VAR}` names the agent requires at runtime. `generateAgentCard` copies them into `AgentCard.runtimeVariables`.

### AgentCard

```typescript
interface AgentCard {
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
```

`runtimeVariables` is a new field. It lists the `@{VAR}` names the agent requires supplied at request time via `RunRequest.runtimeConfig`. An empty array means the agent requires no runtime variables.

### ComposedAgent

```typescript
interface ComposedAgent {
  readonly context: RuntimeContext;
  readonly ast: ScriptNode;
  readonly modules: Record<string, Record<string, RillValue>>;
  readonly card: AgentCard;
  readonly extensions: Record<string, ExtensionResult>;
  readonly deferredExtensions: readonly DeferredExtensionEntry[];
  readonly deferredContext: readonly DeferredContextEntry[];
  readonly runtimeVariables: readonly string[];
  dispose(): Promise<void>;
}
```

| Field | Description |
|-------|-------------|
| `deferredExtensions` | Extensions with `@{VAR}` configs; instantiated per request by `resolveDeferredExtensions` |
| `deferredContext` | Context values with `@{VAR}` templates; resolved per request by `resolveDeferredContext` |
| `runtimeVariables` | Union of all `@{VAR}` names across deferred extensions and deferred context |

### DeferredExtensionEntry

```typescript
interface DeferredExtensionEntry {
  readonly mountAlias: string;
  readonly module: object;
  readonly manifest: object;
  readonly configTemplate: Record<string, unknown>;
  readonly requiredVars: readonly string[];
}
```

`configTemplate` holds the config with `@{VAR}` placeholders still intact. `requiredVars` lists all `@{VAR}` names found in the template.

### DeferredContextEntry

```typescript
interface DeferredContextEntry {
  readonly key: string;
  readonly template: string;
  readonly requiredVars: readonly string[];
}
```

`template` holds the context value string with `@{VAR}` placeholders intact. The harness substitutes variables from `RunRequest.runtimeConfig` before execution.

### SlimHarnessConfig

```typescript
interface SlimHarnessConfig {
  readonly agents: SlimHarnessAgent[];
  readonly concurrency?: number | undefined;
  readonly deploy?: {
    port?: number | undefined;
    healthPath?: string | undefined;
  } | undefined;
}

interface SlimHarnessAgent {
  readonly name: string;
  readonly path: string;
  readonly maxConcurrency?: number | undefined;
}
```

`validateSlimHarness` parses `harness.json` against this schema. Each agent `path` is relative to the harness directory. `composeHarness` resolves each agent path and calls `composeAgent` on the resulting directory.

### InterpolationResult

```typescript
interface InterpolationResult {
  readonly value: string;
  readonly unresolved: readonly string[];
  readonly deferred: readonly string[];
}
```

| Field | Description |
|-------|-------------|
| `value` | The interpolated string with `${VAR}` substituted |
| `unresolved` | Variable names that had no match in env |
| `deferred` | `@{VAR}` names found; these are preserved literally in `value` |

### ConfigInterpolationResult

```typescript
interface ConfigInterpolationResult {
  readonly resolved: Record<string, Record<string, unknown>>;
  readonly deferredKeys: ReadonlyMap<string, readonly string[]>;
}
```

`resolved` is the config object with all `${VAR}` substituted. `deferredKeys` maps `"section.key"` dot-paths to the `@{VAR}` variable names they contain. Empty when no deferred placeholders are present.

### HandlerContext

```typescript
interface HandlerContext {
  readonly agentName: string;
  readonly correlationId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly config: Record<string, Record<string, unknown>>;
  readonly onLog?: ((message: string) => void) | undefined;
  readonly onLogEvent?: ((event: ExtensionEvent) => void) | undefined;
}
```

| Field | Description |
|-------|-------------|
| `agentName` | Agent name this handler belongs to |
| `correlationId` | Caller-provided correlation ID for request tracing |
| `sessionId` | Caller-provided session ID |
| `config` | Agent configuration keyed by section name |
| `onLog` | Optional callback for messages from the `log` host function |
| `onLogEvent` | Optional callback for structured events from extensions |

## Error Classes

### ComposeError

```typescript
class ComposeError extends Error {
  readonly phase: ComposePhase;
  readonly fieldPath?: string;
}
```

The `phase` field identifies where in the composition pipeline the failure occurred.

| Phase | Trigger |
|-------|---------|
| `'validation'` | Config schema validation failed |
| `'resolution'` | Extension package could not be loaded |
| `'compatibility'` | Bundle does not meet platform constraints |
| `'compilation'` | Custom function compilation failed |
| `'bundling'` | Bundle output write failed |
| `'init'` | Project initialization failed |

### ManifestValidationError

```typescript
class ManifestValidationError extends ComposeError {
  readonly issues: readonly ManifestIssue[];
}

interface ManifestIssue {
  readonly path: string;    // dot-notation field path, e.g. "manifest.agents.0.name"
  readonly message: string; // human-readable description of the problem
  readonly line?: number;   // source line number when available
}
```

`ManifestValidationError` is thrown by `validateSlimHarness`. The `issues` array contains one entry per validation failure, with a dot-notation `path` and a human-readable `message`.

## See Also

- [Agent Harness](agent-harness.md) — Production HTTP server that uses these types at runtime
- [Agent Bundle](agent-bundle.md) — CLI and API for building agent bundles from manifests
- [Agent Run](agent-run.md) — Execute bundled agents using the `RunRequest`/`RunResult` types
- [Agent Registry](agent-registry.md) — Service registry client for agent discovery
- [Agent AHI](agent-ahi.md) — Agent-to-agent invocation extension
