# Concepts

Core ideas behind the rill agent framework. Read [Getting Started](getting-started.md) first for a hands-on walkthrough.

## Agents

An agent is a rill script packaged with its dependencies and configuration. Each agent has:

- A **manifest** (`agent.json`) declaring its name, version, entry script, extensions, and I/O contract
- An **entry script** (`.rill` file) containing the execution logic
- Zero or more **extensions** providing host functions (LLM calls, key-value storage, HTTP fetch)
- Optional **custom functions** (TypeScript) compiled at build time via esbuild

Agents accept named parameters as input and return a single rill value as output.

## Manifests

Two manifest types exist: **agent manifests** and **harness manifests**.

### Agent Manifest (`agent.json`)

Defines a single agent. Required fields: `name`, `version`, `runtime`, `entry`.

```json
{
  "name": "classifier",
  "version": "1.0.0",
  "runtime": "@rcrsr/rill@^0.9.0",
  "entry": "classify.rill",
  "extensions": {
    "llm": { "package": "@rcrsr/rill-ext-anthropic" }
  },
  "input": {
    "text": { "type": "string", "required": true }
  }
}
```

Optional fields include `modules`, `functions`, `assets`, `description`, `skills`, `output`, `host`, and `deploy`. See [agent-bundle.md](../packages/agent/bundle/docs/agent-bundle.md) for the full field reference.

### Harness Manifest (`harness.json`)

Runs multiple agents in one process. The `agents` array distinguishes it from an agent manifest.

```json
{
  "shared": {
    "llm": { "package": "@rcrsr/rill-ext-anthropic" }
  },
  "agents": [
    { "name": "classifier", "entry": "classify.rill" },
    { "name": "summarizer", "entry": "summarize.rill" }
  ]
}
```

Shared extensions instantiate once and bind to every agent. Per-agent extensions in `agents[].extensions` are additive. The harness validates that extension namespaces do not collide.

### Manifest Detection

`detectManifestType()` checks for an `agents` key. Returns `'harness'` if present, `'agent'` otherwise. The build tools and host call this before routing to the correct validator.

## Composition Pipeline

The core workflow transforms a manifest into a running agent: **manifest → compose → host → serve**.

### Step 1: Validate

`validateManifest()` or `validateHarnessManifest()` parses raw JSON against the zod schema. Returns a typed manifest or throws `ManifestValidationError` with field-level issues.

### Step 2: Compose

`composeAgent()` takes a validated manifest and:

1. Resolves extensions from npm, built-in, or local paths
2. Instantiates each extension with its runtime config
3. Compiles custom TypeScript functions via esbuild
4. Parses the entry `.rill` script
5. Loads module scripts
6. Generates an `AgentCard` for discovery

Returns a `ComposedAgent` with a `RuntimeContext`, parsed AST, modules, and card.

For harness manifests, `composeHarness()` instantiates shared extensions once, then composes each agent with the merged function map. Returns a `ComposedHarness` with a `Map<string, ComposedAgent>`.

### Step 3: Host

`createAgentHost()` wraps a `ComposedAgent` (or a Map of them) with session management, lifecycle, metrics, and HTTP routing. The host transitions through `READY → RUNNING → STOPPED` phases.

### Step 4: Serve

`host.listen(port)` starts the HTTP server. Alternatively, use `host.run(request)` for programmatic invocation without HTTP.

## Extensions

Extensions provide host functions that rill scripts call at runtime. Each extension registers functions under a namespace (e.g., `llm::generate()`, `kv::get()`).

### Resolution

The `package` field in the manifest determines how an extension loads:

| Pattern | Strategy | Example |
|---------|----------|---------|
| `./` or `../` | Local file | `"./my-ext.js"` |
| `@rcrsr/rill/ext/<name>` | Built-in | `"@rcrsr/rill/ext/kv"` |
| Everything else | npm package | `"@rcrsr/rill-ext-anthropic"` |

Built-in extensions shipped with rill: `fs`, `fetch`, `exec`, `kv`, `crypto`.

### Runtime Config

Extension config is not embedded in the manifest. Pass it at runtime via `--config` (CLI) or the `config` option in the programmatic API. Config values support `${VAR}` interpolation from environment variables.

```bash
rill-agent-run dist/ my-agent --config '{"llm":{"api_key":"${ANTHROPIC_API_KEY}"}}'
```

### Custom Functions

TypeScript functions declared in `agent.json` under `functions` compile via esbuild at bundle time. They register under the `app::` namespace.

```json
{
  "functions": {
    "app::format": "./src/format.ts"
  }
}
```

```rill
app::format($data) => $formatted
```

## Sessions

Each `POST /run` request creates a session. Sessions track execution state, timing, and results.

| State | Description |
|-------|-------------|
| `running` | Script executing |
| `completed` | Finished successfully |
| `failed` | Error or abort |

### Concurrency

`maxConcurrentSessions` caps running sessions globally. In multi-agent mode, per-agent caps distribute capacity across agents. Requests exceeding capacity return HTTP 429.

### TTL

Completed and failed sessions remain queryable for `sessionTtl` milliseconds (default: 3,600,000 ms / 1 hour). After expiry, `GET /sessions/{id}` returns 404.

### SSE Streaming

Connect to `GET /sessions/{id}/stream` for real-time events: `step`, `capture`, `error`, and `done`. Late-connecting clients receive all buffered events.

## AHI (Agent-to-Agent Invocation)

AHI lets one agent call another by name using `ahi::<agentName>()` in rill scripts.

```rill
ahi::summarizer([text: $content]) => $summary
```

### Resolution Modes

**Static URL mode** hardcodes endpoints at deploy time:

```json
{"ahi": {"agents": {"summarizer": {"url": "http://localhost:3001"}}}}
```

**Registry mode** resolves endpoints from a service registry at runtime:

```json
{"ahi": {"agents": ["summarizer", "classifier"], "registry": "http://localhost:4000"}}
```

### In-Process Optimization

When agents share a harness process, `bindHost()` replaces HTTP calls with direct in-process invocation. Scripts use the same `ahi::` syntax. No code changes required.

### Proxy Mediation

The `rill-agent-proxy` mediates AHI calls between agents running as separate child processes. Child processes send NDJSON messages on stdout. The proxy spawns the target agent, collects the result, and writes it back to the caller's stdin.

## Agent Cards

Every agent exposes an A2A-compliant `AgentCard` at `/.well-known/agent-card.json`. The card describes the agent's name, version, capabilities, skills, and supported I/O modes.

```json
{
  "name": "classifier",
  "version": "1.0.0",
  "url": "http://localhost:3000",
  "capabilities": { "streaming": false, "pushNotifications": false },
  "skills": [
    {
      "id": "classify-text",
      "name": "Classify Text",
      "description": "Classifies text into categories"
    }
  ]
}
```

Skills, input modes, and output modes are declared in the manifest and propagated to the card automatically during composition.

## Bundles

`rill-agent-bundle build` produces a self-contained bundle directory:

```
dist/
  agent.json          # Normalized manifest
  *.rill              # Entry and module scripts
  functions/          # Compiled custom functions
  extensions.json     # Resolved extension map
  assets/             # Declared asset files
```

Bundles are the deployment unit. Pass a bundle to `rill-agent-run` for CLI execution, `rill-agent-build` for harness generation, or `rill-agent-proxy` for multi-agent routing.

## See Also

- [Getting Started](getting-started.md) — Build your first agent
- [Architecture](architecture.md) — Package dependency graph and data flow
- [Deployment](deployment.md) — Transport modes and deployment patterns
- [CLI Reference](cli-reference.md) — All commands and flags
