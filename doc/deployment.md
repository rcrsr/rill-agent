# Deployment

Transport modes, multi-agent setups, and deployment patterns for rill agents.

## Build Pipeline

Every deployment starts with the same 2-step build:

```bash
# 1. Bundle the project into a self-contained directory
rill-agent-bundle build

# 2. Generate a harness entry point for the target transport
rill-agent-build --harness <type> dist/
```

The second step writes `dist/harness.js` wired to the chosen transport.

## HTTP Server

The default deployment mode. Runs a persistent Hono-based HTTP server.

```bash
rill-agent-build --harness http dist/
PORT=3000 node dist/harness.js
```

Endpoints available after startup:

| Path | Purpose |
|------|---------|
| `POST /run` | Execute the agent |
| `GET /sessions/{id}/stream` | SSE event stream |
| `GET /healthz` | Liveness probe |
| `GET /readyz` | Readiness probe |
| `GET /metrics` | Prometheus metrics |
| `GET /.well-known/agent-card.json` | Agent discovery card |

### Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY dist/ ./dist/
COPY node_modules/ ./node_modules/
COPY package.json ./
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/harness.js"]
```

Build and run:

```bash
docker build -t my-agent .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" my-agent
```

### Health Checks

Use `/healthz` for liveness and `/readyz` for readiness in container orchestrators.

```yaml
# Kubernetes probe example
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
```

### Graceful Shutdown

On `SIGTERM`, the server stops accepting new sessions and drains active ones for up to `drainTimeout` milliseconds (default: 30,000 ms). On `SIGINT`, the server aborts all sessions immediately.

## Stdio Transport

For CLI tools, pipe-based invocation, and child process communication.

```bash
rill-agent-build --harness stdio dist/
echo '{"params":{"text":"hello"}}' | node dist/harness.js
```

The stdio transport reads NDJSON from stdin and writes results to stdout. The proxy uses this transport internally for spawning agent child processes.

## Serverless (Gateway)

For AWS Lambda, Vercel, and other serverless platforms.

```bash
rill-agent-build --harness gateway dist/
```

The generated `harness.js` exports a named `handler` function:

```javascript
export const handler = createGatewayHarness(handlers);
```

Deploy the `dist/` directory as a Lambda function with `harness.js` as the handler module.

## Cloudflare Workers

```bash
rill-agent-build --harness worker dist/
```

The generated `harness.js` exports a default Workers-compatible module:

```javascript
export default createWorkerHarness(handlers);
```

## Multi-Agent: Harness

Run multiple agents in one process using a harness configuration.

```json
{
  "agents": [
    { "name": "classifier", "path": "./agents/classifier", "maxConcurrency": 10 },
    { "name": "summarizer", "path": "./agents/summarizer", "maxConcurrency": 5 }
  ]
}
```

Each agent directory contains its own `rill-config.json` with extensions and entry point.

Benefits:
- AHI calls between co-located agents use in-process invocation (no HTTP)
- Single process to deploy and monitor

Each agent's routes mount under `/:agentName/` (e.g., `POST /classifier/run`).

## Multi-Agent: Proxy

Run agents as separate child processes with centralized routing.

```bash
rill-agent-proxy --bundles ./bundles --port 3000
```

The proxy scans `./bundles` for agent bundles and registers each as a catalog entry. Requests route to agents via `POST /agents/:name/run`.

```
bundles/
├── feedback-analyzer/
│   ├── bundle.json
│   └── harness.js
└── content-pipeline/
    ├── bundle.json
    └── harness.js
```

Benefits:
- Process isolation between agents
- Independent scaling and resource limits
- Hot-reload via `POST /catalog/refresh`

Trade-offs:
- AHI calls go through proxy mediation (NDJSON over stdio)
- Each request spawns a child process

### Proxy Config

```json
{
  "bundlesDir": "./bundles",
  "port": 3000,
  "concurrency": {
    "maxConcurrent": 10,
    "maxConcurrentPerAgent": 5,
    "requestTimeoutMs": 60000
  },
  "agentConfig": {
    "feedback-analyzer": {
      "llm": { "model": "claude-sonnet-4-20250514" }
    }
  }
}
```

## Choosing a Deployment Model

| Scenario | Model | Transport |
|----------|-------|-----------|
| Single agent, persistent service | HTTP server | `http` |
| Single agent, one-shot CLI | CLI runner | `stdio` |
| Multiple agents, shared resources | Harness | `http` |
| Multiple agents, process isolation | Proxy | `stdio` (internal) |
| Serverless function | Gateway | `gateway` |
| Edge compute | Worker | `worker` |

## See Also

- [Getting Started](getting-started.md) — First agent walkthrough
- [Architecture](architecture.md) — Package map and data flow
- [CLI Reference](cli-reference.md) — All commands and flags
