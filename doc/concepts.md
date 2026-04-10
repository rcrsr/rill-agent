# Concepts

Core ideas behind the rill agent framework. Read [Getting Started](getting-started.md) first for a hands-on walkthrough.

## Agents

An agent is a rill script packaged with its dependencies and configuration. Each agent has:

- A **configuration** (`rill-config.json`) declaring its name, version, entry point, and extensions
- An **entry script** (`.rill` file) containing the execution logic
- Zero or more **extensions** providing host functions (LLM calls, key-value storage, HTTP fetch)

Agents accept named parameters as input and return a single rill value as output.

## Configuration

Two configuration levels exist: **agent configs** and **harness configs**.

### Agent Configuration (`rill-config.json`)

Defines a single agent. Required fields: `name`, `version`, `main`, `runtime`.

```json
{
  "name": "classifier",
  "version": "1.0.0",
  "main": "classify.rill:handler",
  "runtime": ">=0.18.0",
  "extensions": {
    "mounts": {
      "llm": { "package": "@rcrsr/rill-ext-anthropic" }
    },
    "config": {
      "llm": {
        "api_key": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

Extension config supports `${VAR}` interpolation (resolved at load time) and `@{VAR}` interpolation (resolved per invocation). See [rill-config-migration.md](rill-config-migration.md) for details.

### Harness Configuration (`harness.json`)

Runs multiple agents in one process. References per-agent `rill-config.json` directories.

```json
{
  "agents": [
    { "name": "classifier", "path": "./agents/classifier" },
    { "name": "summarizer", "path": "./agents/summarizer" }
  ]
}
```

Each agent directory contains its own `rill-config.json` and scripts. The harness validates that extension namespaces do not collide.

## Composition Pipeline

The core workflow transforms a configuration into a running agent: **config -> compose -> host -> serve**.

### Step 1: Load

`loadProject()` from `@rcrsr/rill-config` parses `rill-config.json`, resolves `${VAR}` interpolation, loads extensions, and builds bindings.

### Step 2: Compose

`composeAgent()` takes a loaded project and:

1. Resolves extensions from npm, built-in, or local paths
2. Instantiates each extension with its runtime config
3. Parses the entry `.rill` script
4. Loads module scripts
5. Generates an `AgentCard` for discovery

Returns a `ComposedAgent` with a `RuntimeContext`, parsed AST, modules, and card.

For harness configurations, `composeHarness()` composes each agent from its own `rill-config.json`. Returns a `ComposedHarness` with a `Map<string, ComposedAgent>`.

### Step 3: Host

`createAgentHost()` wraps a `ComposedAgent` (or a Map of them) with session management, lifecycle, metrics, and HTTP routing. The host transitions through `READY -> RUNNING -> STOPPED` phases.

### Step 4: Serve

`host.listen(port)` starts the HTTP server. Alternatively, use `host.run(request)` for programmatic invocation without HTTP.

## Extensions

Extensions provide host functions that rill scripts call at runtime. Each extension registers functions under a namespace (e.g., `llm::generate()`, `kv::get()`).

### Resolution

The `package` field in the configuration determines how an extension loads:

| Pattern | Strategy | Example |
|---------|----------|---------|
| `./` or `../` | Local file | `"./my-ext.js"` |
| `@rcrsr/rill/ext/<name>` | Built-in | `"@rcrsr/rill/ext/kv"` |
| Everything else | npm package | `"@rcrsr/rill-ext-anthropic"` |

Built-in extensions shipped with rill: `fs`, `fetch`, `exec`, `kv`, `crypto`.

### Runtime Config

Extension config is embedded in `rill-config.json` under `extensions.config`. Config values support `${VAR}` interpolation (static, resolved at load time) and `@{VAR}` interpolation (deferred, resolved per invocation).

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

Completed and failed sessions remain queryable for `sessionTtl` milliseconds (default: 3,600,000 ms / 1 hr). After expiry, `GET /sessions/{id}` returns 404.

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

Skills, input modes, and output modes are declared in the configuration and propagated to the card automatically during composition.

## Bundles

`rill-agent-bundle build` produces a self-contained bundle directory:

```
dist/
  bundle.json          # Bundle metadata
  handlers.js          # Compiled handler entry
  agents/
    <agent-name>/
      scripts/*.rill   # Entry and module scripts
  .well-known/
    agent-card.json    # Agent discovery card
```

Bundles are the deployment unit. Pass a bundle to `rill-agent-run` for CLI execution, `rill-agent-build` for harness generation, or `rill-agent-proxy` for multi-agent routing.

## See Also

- [Getting Started](getting-started.md) -- Build your first agent
- [Architecture](architecture.md) -- Package dependency graph and data flow
- [Deployment](deployment.md) -- Transport modes and deployment patterns
- [CLI Reference](cli-reference.md) -- All commands and flags
