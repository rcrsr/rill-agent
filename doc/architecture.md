# Architecture

Package structure, dependency graph, and data flow for the rill agent framework.

## Package Overview

Packages under `packages/agent/` form three layers.

### Core

| Package | npm | Role |
|---------|-----|------|
| `rill-agent-harness` | `@rcrsr/rill-agent-harness` | HTTP server, lifecycle, session management, metrics, SSE |

### Build

| Package | npm | Role |
|---------|-----|------|
| `rill-agent-bundle` | `@rcrsr/rill-agent-bundle` | Manifest-to-bundle build tool (CLI + API) |
| `rill-agent-build` | `@rcrsr/rill-agent-build` | Harness entry point code generator (CLI + API) |
| `rill-agent-run` | `@rcrsr/rill-agent-run` | CLI runner for agent bundles |

### Infrastructure

| Package | npm | Role |
|---------|-----|------|
| `rill-agent-proxy` | `@rcrsr/rill-agent-proxy` | Multi-agent routing proxy with child process management |
| `rill-agent-ext-ahi` | `@rcrsr/rill-agent-ext-ahi` | Agent-to-agent invocation extension |

## Dependency Graph

```
harness ────┬── bundle ──── run
            │
            ├── build
            │
            ├── proxy
            │
            └── ahi
```

Direction: left depends on right (e.g., `harness` depends on `bundle`).

All packages depend on `@rcrsr/rill` from npm as a direct dependency, except `ahi` which uses it as a peer dependency.

Key relationships:

- `bundle` imports `harness` for `composeAgent` and `composeHarness`.
- `run` imports `bundle` to load bundles and `harness` to execute them.
- `proxy` imports `harness` and `bundle` for child process management.
- `ahi` has no workspace dependencies.

## Data Flow

### CLI Execution (`rill-agent-run`)

```
rill-config.json ──► loadProject() ──► composeAgent() ──► execute() ──► stdout
                     (rill-config)      (harness)          (rill)
```

1. `rill-agent-run` reads `bundle.json` from the bundle directory
2. `loadProject()` parses `rill-config.json`, loads extensions, builds bindings
3. `composeAgent()` resolves extensions, parses the entry script
4. The rill runtime executes the script with injected parameters
5. The result value serializes to JSON on stdout

### HTTP Server (`createAgentHost`)

```
rill-config.json ──► validate ──► compose ──► createAgentHost() ──► listen()
                                              │
                    POST /run ───────► run() ──┤──► SessionRecord
                    GET /sessions/:id/stream ──┤──► SSE events
                    GET /metrics ──────────────┤──► Prometheus text
                    GET /healthz ──────────────┘──► Health status
```

1. Composition produces a `ComposedAgent` (or Map of them)
2. `createAgentHost()` wraps it with session management and HTTP routing
3. Each `POST /run` creates a session, executes the script, and returns the result
4. SSE streams emit `step`, `capture`, `error`, and `done` events

### Multi-Agent Harness

```
harness.json ──────► composeHarness()
                       │
    per-agent rill-config.json ──────────────┤ (each agent loads independently)
    ComposedHarness ─────────────────────────┘
                         │
                    createAgentHost(agents) ──► listen()
                         │
                    bindHost() ──► in-process AHI wiring
```

`composeHarness()` loads each agent from its own `rill-config.json` directory. `bindHost()` replaces HTTP-based AHI functions with direct in-process calls for co-located agents.

### Proxy Architecture

```
bundles/
  ├── agent-a/    ──► catalog entry
  └── agent-b/    ──► catalog entry

POST /agents/:name/run
     │
     ├── spawn child process (node harness.js)
     ├── write run message to stdin (NDJSON)
     ├── read result from stdout (NDJSON)
     └── return HTTP response
```

The proxy scans a bundles directory at startup. Each request spawns a child process. AHI calls between agents route through the proxy as NDJSON messages on stdio.

## Transport Modes

The harness supports 4 transport modes, selected at build time via `rill-agent-build`.

| Mode | Entry Point | Use Case |
|------|-------------|----------|
| `http` | `createHttpHarness` | Long-running server (default) |
| `stdio` | `createStdioHarness` | CLI tools, pipes, child processes |
| `gateway` | `createGatewayHarness` | AWS Lambda, Vercel serverless |
| `worker` | `createWorkerHarness` | Cloudflare Workers |

Each mode imports from a sub-path of `@rcrsr/rill-agent-harness` (e.g., `@rcrsr/rill-agent-harness/http`).

## Extension Resolution

Extensions resolve in 3 ways based on the `package` field pattern:

| Pattern | Strategy | Resolved From |
|---------|----------|---------------|
| `./` or `../` | Local | Relative to manifest directory |
| `@rcrsr/rill/ext/<name>` | Built-in | Named export from rill core |
| Other | npm | `node_modules` via standard resolution |

Built-in extensions: `fs`, `fetch`, `exec`, `kv`, `crypto`.

Resolution runs during composition. `ComposeError` (phase: `'resolution'`) is thrown on missing packages or namespace collisions.

## Observability

### Prometheus Metrics

Both `AgentHost` and `AgentProxy` register their own `prom-client` Registry instances. Metrics do not collide across instances in the same process.

**Harness metrics** (scrape `GET /metrics`):

| Metric | Type |
|--------|------|
| `rill_sessions_total` | Counter |
| `rill_sessions_active` | Gauge |
| `rill_execution_duration_seconds` | Histogram |
| `rill_host_calls_total` | Counter |
| `rill_host_call_errors_total` | Counter |
| `rill_steps_total` | Counter |

**Proxy metrics** (scrape `GET /metrics`):

| Metric | Type |
|--------|------|
| `rill_proxy_requests_total` | Counter |
| `rill_proxy_active_processes` | Gauge |
| `rill_proxy_request_duration_seconds` | Histogram |
| `rill_proxy_ahi_calls_total` | Counter |
| `rill_proxy_concurrency_rejections_total` | Counter |
| `rill_proxy_child_errors_total` | Counter |

### Correlation IDs

Every request propagates `X-Correlation-ID`. When absent, the host generates a UUID. AHI calls forward the root correlation ID through the call chain.

## See Also

- [Concepts](concepts.md) — Manifests, extensions, sessions, and AHI
- [Deployment](deployment.md) — Transport modes and deployment patterns
- [CLI Reference](cli-reference.md) — All commands and flags
