# foundry-echo

A minimal rill agent exposed over
[`@rcrsr/rill-agent-foundry`](../../packages/agent/foundry), which speaks the
Azure AI Foundry Responses API. The agent echoes the request's `input` text.

## Layout

```
main.rill           # rill source — a typed closure |input: string| -> string
rill-config.json    # rill project config (entry: main.rill:echo)
rill-bundle.json    # rill 0.20 bundle config — declares the Foundry harness
server.js           # manual host: loadManifest + createRouter + createFoundryHarness
package.json        # workspace package (declares the @opentelemetry/api peer)
```

## Run as a rill 0.20 bundle (recommended)

`rill-bundle.json` declares `@rcrsr/rill-agent-foundry` as the bundle harness, so
`rill run` builds the package and serves it on `config.port` (3002).

```bash
pnpm install       # links the workspace harness into this package's node_modules
rill init          # bootstraps .rill/ (gitignored); one-time per checkout
rill run           # builds, then serves on :3002
```

> The harness is resolved from this package's workspace `node_modules`, so no
> `rill install` step is needed while `@rcrsr/rill-agent-foundry` is unpublished.
> `@opentelemetry/api` is a peer dependency of the harness and is declared here.

Then, from another shell:

```bash
curl -X POST http://localhost:3002/responses \
  -H 'Content-Type: application/json' \
  -d '{"input":"hello"}'
# {"id":"resp_...","status":"completed","output":[{"type":"message","role":"assistant",
#   "content":[{"type":"text","text":"hello"}]}], ...}

curl http://localhost:3002/liveness    # {"status":"ok"}
curl http://localhost:3002/readiness   # {"status":"ok"} once routes are registered
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/responses` | Foundry Responses endpoint (sync or SSE) |
| `POST` | `/runs` | Alias for `/responses` |
| `GET` | `/liveness` | Liveness probe |
| `GET` | `/readiness` | Readiness probe |
| `GET` | `/metrics` | Prometheus metrics |

`input` may be a string or a Responses-API input array; the last user message's
text becomes the agent's `input` param. Stream by adding `"stream": true` to the
request body.

## Run manually (library host)

```bash
pnpm --filter foundry-echo start   # node server.js, listens on PORT (default 3002)
```

`server.js` loads the compiled manifest from `build/foundry-echo/` and wraps it
with `createFoundryHarness`. Produce `build/` with `rill run` once before
starting it manually. Outbound Azure Conversations calls (session persistence)
require `DefaultAzureCredential`; the echo path here does not exercise them.
