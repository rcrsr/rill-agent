# rill-config Migration Analysis

Findings and open questions for aligning rill-agent with `@rcrsr/rill-config@0.18.0`.

## Current State

All 5 packages that depend on `@rcrsr/rill` pin version `^0.18.4`. Migration is complete.

| Package | Dep type | Current |
|---------|----------|---------|
| shared | dependency | ^0.18.4 |
| harness | dependency | ^0.18.4 |
| bundle | dependency | ^0.18.4 |
| run | dependency | ^0.18.4 |
| ahi | peer ~0.18.4 + dev ^0.18.4 |

## Obsolete Concepts

These rill-agent constructs duplicate functionality now provided by rill-config.

### agent.json and harness.json manifests

rill-config.json replaces both manifest formats. The current `AgentManifest` and `HarnessManifest` zod schemas in `shared/schema.ts` validate fields that rill-config now owns.

| agent.json field | rill-config.json equivalent |
|---|---|
| `runtime: "@rcrsr/rill@*"` | `runtime: ">=0.18.0"` (semver range) |
| `entry: "scripts/main.rill"` | `main: "scripts/main.rill"` or `main: "scripts/main.rill:handler"` |
| `modules: { alias: "path.rill" }` | `modules: { alias: "./dir" }` (folder aliasing, not file) |
| `extensions: { alias: { package } }` | `extensions.mounts: { alias: "package" }` |
| `host.timeout` | `host.timeout` |
| `host.maxCallStackDepth` | `host.maxCallStackDepth` |
| (none) | `host.setupTimeout` (new) |

### config.json (extension configuration)

The separate `config.json` file merges into rill-config.json's `extensions.config` block. rill-config provides `${VAR}` interpolation (static, resolved at load time) and `@{VAR}` interpolation (deferred, resolved per invocation). The harness provides all variable values — rill-config never reads `process.env` directly.

Current pattern:
```
agent.json      # manifest
config.json     # extension config: { "llm": { "api_key": "${KEY}" } }
```

New pattern:
```
rill-config.json   # manifest + context in one file
```

### Extension resolution in compose.ts

`compose.ts` implements extension loading from three sources (npm, local `./`, builtin `@rcrsr/rill/ext/*`), config schema extraction, factory invocation, and function hoisting. rill-config's `loadExtensions()` replaces all of this.

### Binding and resolver generation in compose.ts

`compose.ts` builds RuntimeContext with manually assembled function maps and resolvers. rill-config provides `buildExtensionBindings()`, `buildContextBindings()`, and `buildResolvers()` to generate these from the loaded project.

### Manifest validation in shared/schema.ts

The `AgentManifestSchema` and `HarnessManifestSchema` zod validators enforce the old format. rill-config's `parseConfig()` handles parsing and validation for the new format.

## What rill-agent Still Owns

These concepts have no rill-config equivalent and remain in rill-agent.

### Agent card generation (A2A protocol)

- `AgentCard` assembly from handler introspection (input, output, description) + rill-config sections (skills, deploy)
- Card served at `/.well-known/:agentName/agent-card.json`

### Multi-agent orchestration

- Harness config referencing per-agent rill-config.json projects
- AHI in-process routing via `bindHost()`
- Per-agent concurrency caps

### Host lifecycle

- Session management (create, track, TTL pruning, abort)
- Global and per-agent concurrency limits
- Deferred extension resolution per invocation (Q7)
- Metrics collection (prom-client)
- SSE event streaming (`step`, `capture`, `error`, `done`)
- Callback delivery (POST RunResponse to URL)
- Registry integration (heartbeat, deregister)

### Transport layer

- HTTP server (Hono routes per agent)
- stdio protocol with AHI bridge
- API Gateway / Lambda adapter
- Worker transport

### Bundle pipeline

- Local extension compilation (TypeScript → JS)
- rill-config.json path rewriting for compiled output
- Build-time validation via `loadProject()` dry-run
- Checksum and version metadata

## Resolved Decisions

### Q1: Custom functions — RESOLVED: Drop

`manifest.functions` compiled TypeScript via esbuild and registered functions in the runtime context. No demo app uses this feature.

rill-config's local extension support (`"mounts": { "app": "./my-ext" }`) replaces it with a better model. A minimal extension is 16 lines: one file exporting `extensionManifest` with a factory function. Local extensions gain config schema validation, lifecycle hooks (`dispose`, `suspend`, `restore`), and observability events for free.

The esbuild compilation pipeline in `compose.ts` and the `manifest.functions` field in `shared/schema.ts` can be deleted.

### Q2: Multi-agent project structure — RESOLVED: Per-agent rill-config.json

Each agent gets its own `rill-config.json` in a subdirectory. A harness-level config references them by path.

```
my-harness/
├── harness.json                  # harness-only fields (agents list, concurrency, deploy)
├── agents/
│   ├── classifier/
│   │   ├── rill-config.json      # standard rill project
│   │   └── scripts/main.rill
│   ├── summarizer/
│   │   ├── rill-config.json
│   │   └── scripts/main.rill
│   └── orchestrator/
│       ├── rill-config.json
│       └── scripts/main.rill
```

This keeps agents fully isolated. Each agent is a valid rill project that `loadProject()` can load independently. The harness config becomes a thin orchestration layer that references agent directories and adds multi-agent concerns (AHI routing, concurrency caps, deploy config).

The current `HarnessManifest` schema (shared extensions, inline agent definitions) is replaced by directory references. Shared extension config is eliminated — each agent declares its own extensions. If two agents use the same extension, rill-config handles loading independently per project.

### Q3: Agent-specific fields — RESOLVED: Extend rill-config.json

All agent-specific fields move into rill-config.json as new sections. This eliminates agent.json entirely.

**Introspectable from the handler closure** (requires handler mode, no naked agents):
- `input` — reflected from `closure.params[]` (name, type.kind, required, defaultValue, description annotation)
- `output` — reflected from `closure.returnType` (RillTypeValue with kind). Requires adding `returnType` to `introspectHandler()` in rill-config.
- `description` — reflected from `closure.annotations['description']`

**New rill-config.json sections** (requires rill-config changes):
- `skills[]` — A2A discovery metadata (id, name, description, tags, examples, inputModes, outputModes)
- `deploy` — transport config (port, healthPath)

**Dropped fields:**
- `host.requireDescriptions` — policy flag, no longer needed
- `assets[]` — build-time concern, handled by bundle tool if needed
- `manifest.functions` — replaced by local extensions (see Q1)

**Constraint:** Agents must use handler mode (`main: "file.rill:handler"`). Module-mode ("naked") agents are not supported. This enables full introspection of input, output, and description without redundant schema declarations.

### Q4: Bundle pipeline — RESOLVED: Slim build tool

The bundle step remains because agents may bring local extensions (TypeScript source that needs compilation). `loadProject()` handles extension loading, binding generation, and resolver assembly at runtime.

**Bundle responsibilities (post-migration):**
1. Compile local extensions (TypeScript → JS)
2. Copy .rill files (entry + modules)
3. Copy rill-config.json with local extension paths rewritten to compiled output
4. Validate via `loadProject()` dry-run (fail at build time, not deploy time)
5. Generate metadata (checksum, rill version snapshot)

**Removed from bundle:**
- agent.json / harness.json parsing (replaced by rill-config.json)
- Extension resolution and validation (runtime via `loadProject()`)
- Custom function compilation (dropped, see Q1)
- AgentCard / card.json generation (runtime via handler introspection, see Q3)
- handlers.js code generation with inline composition logic

**handlers.js becomes a thin loader** that calls `loadProject()` + `invokeCallable()` at startup. All composition, binding generation, and resolver assembly happens at runtime through rill-config.

### Q5: Module format change — RESOLVED: Adopt rill-config directory convention

rill-config `modules` maps aliases to directories. `module:alias.sub` resolves to `dir/sub.rill`, `module:alias` resolves to `dir/index.rill`. The current `manifest.modules` maps aliases to individual .rill files.

Adopt the rill-config convention. Existing demo agents restructure from:

```json
{ "modules": { "utils": "scripts/utils.rill" } }
```

To:

```json
{ "modules": { "utils": "./scripts/utils" } }
```

Where `./scripts/utils/` is a directory containing .rill files addressable by dot-path. Single-file modules become `index.rill` inside a directory, or the file moves into a parent directory and is addressed by name.

### Q6: config.json to context migration — RESOLVED: Merged into extensions.config

The current `config.json` passes arbitrary nested objects to extensions (e.g., `{ "llm": { "api_key": "...", "model": "..." } }`). This maps directly to rill-config's `extensions.config` block, which already supports nested objects keyed by mount alias. No migration to the flat `context.schema` model is needed.

```json
{
  "extensions": {
    "mounts": { "llm": "@rcrsr/rill-ext-openai" },
    "config": {
      "llm": {
        "api_key": "${OPENAI_API_KEY}",
        "model": "gpt-4o"
      }
    }
  }
}
```

Static values use `${VAR}` (resolved at load time). See Q7 for per-invocation dynamic config.

### Q7: Static vs deferred extension initialization (NEW — requires rill-config changes)

Agents must support stateless per-invocation configuration. A caller may provide different values per request (e.g., different filesystem root to virtualize storage per tenant).

**Interpolation syntax:**
- `${VAR}` — static, resolved at load time
- `@{VAR}` — deferred, resolved per invocation

Both are opaque to rill-config. The caller (harness) always provides the variable map — rill-config never reads `process.env` directly. The harness decides whether to resolve from environment, secrets manager, request payload, or any other source.

`@{VAR}` is valid in two locations:
- `extensions.config` — defers the extension whose config contains the placeholder
- `context.values` — defers the context value (no extension impact, resolved before RuntimeContext assembly)

`@{VAR}` is rejected in `host`, `modules`, and other top-level fields — these are structural and must be known at load time.

```json
{
  "extensions": {
    "mounts": {
      "llm": "@rcrsr/rill-ext-openai",
      "fs": "@rcrsr/rill/ext/fs"
    },
    "config": {
      "llm": {
        "api_key": "${OPENAI_API_KEY}",
        "model": "gpt-4o"
      },
      "fs": {
        "root": "@{STORAGE_ROOT}"
      }
    }
  },
  "context": {
    "schema": {
      "app_name": { "type": "string" },
      "tenant_id": { "type": "string" },
      "locale": { "type": "string" }
    },
    "values": {
      "app_name": "${APP_NAME}",
      "tenant_id": "@{TENANT_ID}",
      "locale": "@{LOCALE}"
    }
  }
}
```

In this example, `llm` is static (loaded once at startup). `fs` is deferred (its config contains `@{STORAGE_ROOT}`). Context mixes both: `app_name` resolves at load time via `${APP_NAME}`, while `tenant_id` and `locale` resolve per invocation via `@{VAR}`. Static context values are available immediately; deferred context values are injected into the RuntimeContext before each execution.

**`loadProject()` changes:**

The `env` parameter in `loadProject()` provides values for `${VAR}` interpolation. The harness passes these — rill-config has no opinion on where they come from.

1. `parseConfig()` resolves `${VAR}` from the provided variable map, preserves `@{VAR}` as runtime placeholders
2. `loadExtensions()` partitions mounts into two groups by analyzing config for `@{VAR}`:
   - **Static**: no runtime placeholders → factory invoked at load time (current behavior)
   - **Deferred**: config contains `@{VAR}` → module imported, manifest validated, factory NOT invoked
3. `ProjectResult` gains a `deferredExtensions` field with factory references and unresolved config templates

**At invocation time (rill-agent harness responsibility):**
1. Caller provides runtime values in the request: `{ runtimeConfig: { STORAGE_ROOT: "/tenant/42/files", TENANT_ID: "42", LOCALE: "en-US" } }`
2. Harness calls `resolveDeferredExtensions(deferred, runtimeValues)` (new rill-config function) to instantiate deferred extensions
3. Harness resolves `@{VAR}` in deferred context values
4. RuntimeContext merges static extensions + deferred extensions + resolved context values
5. Agent executes
6. Deferred extensions are disposed after execution completes

**Extensions themselves do not change.** They always receive concrete config values from their factory. The static vs deferred split is determined entirely by the config author's use of `${VAR}` vs `@{VAR}`.

**Static and dynamic values can mix within a single extension config block.** An extension that needs both a load-time API key and a per-invocation tenant root is deferred (because it contains at least one `@{VAR}`), but its static `${VAR}` values are resolved at parse time. Only the `@{VAR}` placeholders remain unresolved until invocation.

```json
{
  "fs": {
    "api_key": "${FS_API_KEY}",
    "root": "@{STORAGE_ROOT}"
  }
}
```

`FS_API_KEY` resolves at load time. `STORAGE_ROOT` resolves per invocation. The extension factory receives both as concrete strings when invoked.

**Required rill-config changes:**
- `parseConfig()`: recognize `@{VAR}` pattern, preserve as typed placeholder instead of resolving. Accept caller-provided variable map for `${VAR}` resolution (already the case — `env` parameter).
- `loadExtensions()`: partition mounts by static vs deferred based on config analysis
- `ProjectResult`: add `deferredExtensions` field (factory + manifest + unresolved config template)
- New `resolveDeferredExtensions(deferred, runtimeValues)` function that resolves placeholders and invokes factories
- Validation: `@{VAR}` is valid in `extensions.config` and `context.values`. Reject in `host`, `modules`, and other structural fields.

### Q8: CLI defaults — RESOLVED: Default to working directory

All CLI tools default to the current working directory when no path argument is provided.

```bash
# from agent directory — no path needed
rill-agent-run
rill-agent-bundle build
rill-agent-build --harness http

# explicit path when running from elsewhere
rill-agent-run ./agents/classifier
```

**RunRequest contract change (rill-agent harness):**

`RunRequest` gains a `runtimeConfig` field for per-invocation variable resolution:

```typescript
interface RunRequest {
  params?: Record<string, unknown>;       // agent handler arguments
  runtimeConfig?: Record<string, string>; // @{VAR} resolution values
  correlationId?: string;
  timeout?: number;
  trigger?: TriggerType;
  callback?: string;
}
```

The harness validates that all `@{VAR}` keys declared in the config are present in `runtimeConfig` before invoking deferred factories. Missing keys produce a 400-level error with the list of required runtime variables.

Example request:
```json
{
  "params": { "query": "summarize recent activity" },
  "runtimeConfig": { "STORAGE_ROOT": "/tenant/42/files" }
}
```

The harness exposes required runtime variable names via the agent card or a discovery endpoint so callers know what to provide.

### Q9: Developer-supplied runtime config resolver — DEFERRED

In production, `runtimeConfig` values need to come from somewhere: request headers, JWT claims, a secrets manager, a tenant lookup service. Passing raw values in the HTTP body works for simple cases but breaks down when the resolution logic is non-trivial.

The harness needs a mechanism for developers to supply a resolver that maps an incoming request to `runtimeConfig` values. Open questions:

- Is this a function hook registered at harness startup?
- Is it a rill-config extension that produces context values?
- Does it run before or after authentication/authorization?
- Can it be async (e.g., fetch tenant config from a database)?
- How does it interact with the deferred extension lifecycle?

To be designed after the core migration is complete.

## Implementation Strategy: Custom Extension Loading

To avoid blocking on upstream rill-config changes, the harness implements its own extension loading layer that wraps rill-config's existing API.

**What rill-config provides today (use as-is):**
- `parseConfig()` with `${VAR}` interpolation from caller-provided variable map
- `loadExtensions()` for static extensions (no `@{VAR}`)
- `buildExtensionBindings()`, `buildContextBindings()`, `buildResolvers()`
- `introspectHandler()`, `marshalCliArgs()`, `parseMainField()`
- Extension manifest validation and version checking

**What the harness implements internally:**
- `@{VAR}` recognition and placeholder preservation during config parsing
- Partition of extensions into static vs deferred based on `@{VAR}` presence
- Deferred extension module import + manifest validation at load time
- `resolveDeferredExtensions()` per invocation (resolve placeholders, invoke factories)
- Deferred context value resolution per invocation
- `skills[]` and `deploy` section parsing (rill-config ignores unknown fields)

**Migration path:** When rill-config adds native `@{VAR}` support, the harness replaces its custom parsing and deferred loading with upstream calls. The `RunRequest.runtimeConfig` contract and per-invocation lifecycle remain in the harness regardless.

## Required rill-config Changes (upstream, non-blocking)

Consolidated list of changes needed in `@rcrsr/rill-config` before rill-agent migration can proceed.

### Deferred interpolation (`@{VAR}`)

- `parseConfig()`: recognize `@{VAR}` pattern alongside `${VAR}`. Preserve `@{VAR}` as typed placeholder objects instead of resolving.
- Validation: `@{VAR}` is valid in `extensions.config` and `context.values`. Reject in `host`, `modules`, and other structural fields that must be known at load time.

### Deferred extension loading

- `loadExtensions()`: partition mounts into static vs deferred by scanning config for `@{VAR}` placeholders. Static mounts invoke factories at load time (current behavior). Deferred mounts import the module and validate the manifest but skip factory invocation.
- `ProjectResult`: add `deferredExtensions` field containing factory references, validated manifests, and unresolved config templates.
- New `resolveDeferredExtensions(deferred, runtimeValues)` function: resolves `@{VAR}` placeholders in config templates, invokes deferred factories, returns extension results with dispose handlers.

### Deferred context values

- `context.values` supports `@{VAR}` placeholders. These do not affect extension loading — they are resolved per invocation and injected into the RuntimeContext before execution.
- `ProjectResult`: include deferred context entries (schema + unresolved value templates) alongside static context values.

### Handler introspection

- `introspectHandler()`: add `returnType` field to `HandlerIntrospection` from `closure.returnType`. Currently returns params and description only.

### New config sections

- `skills[]`: array of A2A skill descriptors (id, name, description, tags, examples, inputModes, outputModes). Parsed and validated by rill-config, consumed by rill-agent for AgentCard generation.
- `deploy`: transport configuration (port, healthPath). Parsed by rill-config, consumed by rill-agent harness and build tools.

### Environment decoupling

- `parseConfig()` already accepts a caller-provided `env` parameter. Confirm no code path reads `process.env` directly. The harness owns variable resolution strategy.

## Dependency Changes (Completed)

Version bumps applied:

```
@rcrsr/rill          ^0.9.0  →  ^0.18.4   (shared, harness, bundle, run, ahi)
@rcrsr/rill-config   (new)   →  ^0.18.4   (harness, bundle, run, proxy)
```
