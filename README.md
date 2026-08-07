# rill-agent

[![CI](https://github.com/rcrsr/rill-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rcrsr/rill-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/rcrsr/rill-agent)](https://github.com/rcrsr/rill-agent/blob/main/LICENSE)

Write an agent once as a typed [rill](https://github.com/rcrsr/rill) closure. Serve it over plain HTTP, an OpenAI-compatible chat endpoint, or the Azure AI Foundry Responses API by changing one field in a config file. The same rill package moves between transports without touching the code.

- **One closure, three transports.** The rill source is identical for HTTP, OpenAI-chat, and Foundry; only the `harness` field in `rill-bundle.json` differs.
- **Validation for free.** `describe()` embeds the closure's parameter types, so a wrong-typed request returns HTTP 400 before your code runs. You write no validation.
- **Compose by config, not code.** Co-located agents call each other in-process; remote agents resolve by URL. Moving one across the network is a config change.
- **Run and test in three commands.** `pnpm install && rill init && rill run`, then curl the endpoint — the loop every demo uses. Production deploy to Azure Foundry follows a [documented path](packages/agent/foundry/docs/deploy-foundry-agent.md).

A rill script becomes an `AgentHandler` exposing `describe`, `init`, `execute`, and `dispose`. The runtime loads one or more handlers from a manifest, builds a router that wires up agent-to-agent invocation, and serves it over HTTP or a third-party agent framework integration.

## Try it

Clone, install, and hit a live agent in under a minute:

```bash
cd demo/http-echo
pnpm install    # links the HTTP harness into node_modules
rill init       # bootstraps .rill/ (gitignored); one-time
rill run        # builds the package, serves on :3001

# from another shell:
curl -X POST http://localhost:3001/run \
  -H 'Content-Type: application/json' \
  -d '{"params":{"input":"hello"}}'
# {"state":"completed","result":"hello","streamed":false}
```

Swap the `harness` field in `rill-bundle.json` for `@rcrsr/rill-agent-chat` or `@rcrsr/rill-agent-foundry` and the same closure answers on an OpenAI or Foundry endpoint instead. Requires [`@rcrsr/rill-cli`](https://github.com/rcrsr/rill-cli) ≥ 0.20 on `PATH`.

## The pipeline

```
manifest -> router -> harness -> serve
```

1. **`loadManifest(dir)`** auto-detects the layout (single-agent `handler.js`, nested single-agent, or multi-agent `manifest.json`) and imports each handler module.
2. **`createRouter(manifest, options?)`** calls `describe()` on every handler, builds an in-process AHI resolver, runs `init()` concurrently, and returns an `AgentRouter`.
3. **A harness** wraps the router in a Hono server. `httpHarness` speaks plain HTTP, `createChatHarness` speaks the OpenAI chat completions API, `createFoundryHarness` speaks the Foundry Responses API.
4. **`serve`** listens on a port. Either you call `harness.listen(port)` from your own `server.js`, or the rill CLI's bundle mode calls the harness for you.

## Two ways to host: `rill run` vs a library host

Every harness package ships **two entry points into the same code**:

- A named factory (`httpHarness`, `createChatHarness`, `createFoundryHarness`) you wire by hand in a `server.js`.
- A default-export `RillHarness` adapter the **rill CLI** drives in bundle mode.

They produce the same running server. Pick by how much control you want over process startup.

### rill CLI bundle mode (recommended)

`rill run` reads `rill-bundle.json`, builds every package it lists, then hands the compiled output to the harness named in `harness`. No `server.js`, no manual `loadManifest`/`createRouter`. This is where **rill-cli composition** happens: the bundle file is the single place that names the transport, the port, and which rill packages get hosted together.

```json
{
  "name": "my-agent",
  "harness": "@rcrsr/rill-agent-http",
  "defaultPackage": "my-agent",
  "config": { "port": 3001 },
  "packages": [{ "mount": "my-agent", "project": "." }]
}
```

```bash
pnpm install    # links the harness into node_modules
rill init       # bootstraps .rill/ (gitignored); one-time per checkout
rill run        # builds every package, then serves via the declared harness
```

The harness's `serve` hook receives the bundle's compiled packages, assembles a router from them (`assembleManifest` maps each `mount` to an agent name), and listens on `config.port`. Swap the transport by editing one field:

| `harness` value | Endpoint the bundle exposes |
|-----------------|-----------------------------|
| `@rcrsr/rill-agent-http` | `GET /agents`, `POST /run`, `POST /agents/:name/run` |
| `@rcrsr/rill-agent-chat` | `POST /v1/chat/completions` (SSE), `/health`, `/metrics` |
| `@rcrsr/rill-agent-foundry` | `POST /responses` (or `POST /runs`) (sync or SSE), `/liveness`, `/readiness`, `/metrics` |

> Requires [`@rcrsr/rill-cli`](https://github.com/rcrsr/rill-cli) ≥ 0.20 on `PATH`. Published harnesses record into `.rill/npm/` via `rill install <harness> --replace`; the harness declares `"role": "harness"`, which the install gate requires.

### Library host (manual control)

When you need custom middleware, a shared process, or startup logic the bundle does not express, wire the router yourself:

```typescript
import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import { httpHarness } from '@rcrsr/rill-agent-http';

const manifest = await loadManifest('./build');
const router = await createRouter(manifest, {
  globalVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
});
const harness = httpHarness(router);

// harness.app is the underlying Hono instance — add routes or middleware here
await harness.listen(3000);
```

Produce `build/` with `rill run` (or `rill build`) once, then start the host with `node server.js`. Every demo ships both a `server.js` and a `rill-bundle.json` so you can compare the two paths side by side.

## Use cases

### 1. Ship a rill script as an HTTP service

You have a typed rill closure and want it reachable over HTTP with parameter validation. The whole agent is the closure plus a bundle file.

`main.rill` — a closure that takes a string and returns a string:

```rill
|input: string| {
  $input
}:string => $echo
```

`rill-bundle.json` names the HTTP harness and a port. `rill run` serves it:

```bash
curl -X POST http://localhost:3001/run \
  -H 'Content-Type: application/json' \
  -d '{"params":{"input":"hello"}}'
# {"state":"completed","result":"hello","streamed":false}
```

`describe()` embeds the closure's `input: string` signature, so a request with the wrong param type returns HTTP 400 before the closure runs. See [`demo/http-echo`](demo/http-echo).

### 2. Expose an agent to any OpenAI client

Declare `@rcrsr/rill-agent-chat` as the harness and the same router answers on `POST /v1/chat/completions` with SSE streaming. The `model` field selects the agent by name, so the openai SDK, LiteLLM, and the Vercel AI SDK talk to your rill agent unmodified.

The rill closure declares the full chat signature and yields OpenAI-shaped chunks:

```rill
|messages: list(dict(role: string, content: string))| {
  $messages[-1] => $last
  $last.content => $text
  [ choices: [[ delta: [role: "assistant", content: $text], finish_reason: "stop" ]] ] -> yield
  $text
}:stream(dict(choices: list(dict(delta: dict(role: string, content: string), finish_reason: string)))):string => $chat
```

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"chat-echo","messages":[{"role":"user","content":"hello rill"}]}'
```

The harness validates the closure's signature at construction (`describe()` must declare `messages` and the stream chunk shape) and throws `ChatSignatureError` on a mismatch, so a malformed agent fails at startup rather than on the first request. See [`demo/chat-echo`](demo/chat-echo).

### 3. Host on Azure AI Foundry

Point the bundle at `@rcrsr/rill-agent-foundry` and the router speaks the Foundry Responses API: `POST /responses`, `input` as a string or a Responses-API input array, sync or SSE by toggling `"stream": true`. The harness adds Azure AI Conversations session persistence, OpenTelemetry tracing, Entra ID auth, liveness/readiness probes, and a JSON `/metrics` endpoint on top of the same router.

```bash
curl -X POST http://localhost:3002/responses \
  -H 'Content-Type: application/json' \
  -d '{"input":"hello"}'
```

The rill source is identical to the HTTP case (a `|input: string|` closure); only the harness field in `rill-bundle.json` differs. See [`demo/foundry-echo`](demo/foundry-echo) and the [deployment guide](packages/agent/foundry/docs/deploy-foundry-agent.md).

### 4. Compose several agents in one bundle

The `packages` array in `rill-bundle.json` takes more than one entry. Each becomes an agent in a **single router hosted by one harness on one port**. `assembleManifest` maps every package's `mount` to an agent name; the router's default agent answers `/run`, and each agent has its own `/agents/:name/run`.

```json
{
  "name": "content-pipeline",
  "harness": "@rcrsr/rill-agent-http",
  "defaultPackage": "router-agent",
  "config": { "port": 3001 },
  "packages": [
    { "mount": "router-agent", "project": "./router" },
    { "mount": "classifier",   "project": "./classifier" },
    { "mount": "summarizer",   "project": "./summarizer" }
  ]
}
```

Co-located agents call each other **in-process**: `createRouter` builds an AHI resolver that calls `router.run(name, request)` directly, so an agent invoking a sibling skips the HTTP hop and the JSON round-trip. A `router-agent` that classifies text, then summarizes it, is three rill closures sharing one process, wired by name rather than by URL.

### 5. Fan out to agents on other hosts

When agents live in separate processes or on separate machines, the AHI extension resolves them by static URL. Mount `ahi` in `rill-config.json` and give it an `agents` map; the calling closure hoists the mount and invokes a peer by name:

```rill
|text: string| {
  use<ext:ahi> => $ahi
  $ahi.echo([input: $text]) => $reply
  $reply
}:string => $caller
```

```json
{
  "extensions": {
    "mounts": { "ahi": "@rcrsr/rill-agent-ext-ahi" },
    "config": {
      "ahi": {
        "agents": { "echo": { "url": "http://localhost:3001" } },
        "timeout": 10000
      }
    }
  }
}
```

Each call sends `POST /run` to the peer's URL, propagates the caller's agent name and session id for tracing, and forwards the smaller of the remaining deadline or the configured timeout so a downstream agent never outlives its caller. URLs support `${VAR_NAME}` substitution, so the same bundle points at localhost in dev and service DNS in production. Connection failures surface as typed rill halts (`RILL-R028` unreachable, `RILL-R031` transport). See [`demo/ahi-caller`](demo/ahi-caller).

The same `$ahi.<name>` script runs unchanged whether the peer is in-process (use case 4) or across the network (use case 5). Moving an agent between the two is a config change, not a code change.

## Demos

Runnable examples live under [`demo/`](demo), each a rill 0.20 bundle you start
with `rill init && rill run` (needs [`@rcrsr/rill-cli`](https://github.com/rcrsr/rill-cli) ≥ 0.20 on `PATH`):

| Demo | Harness | Shows |
|------|---------|-------|
| [`http-echo`](demo/http-echo) | `@rcrsr/rill-agent-http` | `GET /agents`, `POST /run` (use case 1) |
| [`chat-echo`](demo/chat-echo) | `@rcrsr/rill-agent-chat` | OpenAI-compatible streaming chat (use case 2) |
| [`foundry-echo`](demo/foundry-echo) | `@rcrsr/rill-agent-foundry` | Foundry Responses API (use case 3) |
| [`ahi-caller`](demo/ahi-caller) | `@rcrsr/rill-agent-http` | agent-to-agent invocation via AHI (use case 5) |

Each demo ships both a `rill-bundle.json` (the `rill run` path) and, where relevant, a `server.js` (the library-host path), so you can read the composition two ways.

## Packages

All packages are published under `@rcrsr/` on npm. Every publishable package
shares the same `major.minor`; patch versions may differ per package.

| Category | Package | npm | Docs | Description |
|----------|---------|-----|------|-------------|
| **Runtime** | [`rill-agent`](packages/agent/core) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent)](https://www.npmjs.com/package/@rcrsr/rill-agent) | [docs](packages/agent/core/docs/agent-core.md) | Manifest loader and router |
| **Extensions** | [`rill-agent-ext-ahi`](packages/agent/ahi) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-ext-ahi)](https://www.npmjs.com/package/@rcrsr/rill-agent-ext-ahi) | [docs](packages/agent/ahi/docs/agent-ahi.md) | Agent-to-agent invocation |
| **Hosting** | [`rill-agent-http`](packages/agent/http) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-http)](https://www.npmjs.com/package/@rcrsr/rill-agent-http) | [docs](packages/agent/http/README.md) | HTTP harness for `AgentRouter` |
| | [`rill-agent-foundry`](packages/agent/foundry) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-foundry)](https://www.npmjs.com/package/@rcrsr/rill-agent-foundry) | [docs](packages/agent/foundry/docs/agent-foundry.md) | Azure Foundry Responses API harness |
| | [`rill-agent-chat`](packages/agent/chat) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-chat)](https://www.npmjs.com/package/@rcrsr/rill-agent-chat) | [docs](packages/agent/chat/docs/agent-chat.md) | OpenAI-compatible chat completions harness (SSE) |

`@rcrsr/rill-agent` is transport-agnostic and has no runtime dependency on `hono`. The three harness packages each depend on it and carry the `hono` runtime deps. `ahi` uses `@rcrsr/rill` as a peer dependency.

## Documentation

Each package documents its own surface:

| Package | Docs |
|---------|------|
| `@rcrsr/rill-agent` | [agent-core.md](packages/agent/core/docs/agent-core.md) |
| `@rcrsr/rill-agent-http` | [README](packages/agent/http/README.md) |
| `@rcrsr/rill-agent-foundry` | [agent-foundry.md](packages/agent/foundry/docs/agent-foundry.md), [deploy-foundry-agent.md](packages/agent/foundry/docs/deploy-foundry-agent.md) |
| `@rcrsr/rill-agent-chat` | [agent-chat.md](packages/agent/chat/docs/agent-chat.md) |
| `@rcrsr/rill-agent-ext-ahi` | [agent-ahi.md](packages/agent/ahi/docs/agent-ahi.md) |

## Versioning

Every publishable package sits at the same `major.minor` as the root manifest,
which is the version a release tag matches; patch versions may differ per
package. `pnpm check:versions` enforces this. `@rcrsr/rill` peer ranges match the
runtime by minor. See [CLAUDE.md](CLAUDE.md#versioning-and-release).

## Development

```bash
pnpm install       # also wires git hooks
pnpm build         # build the publishable packages
pnpm test          # run all tests
pnpm check         # full validation (build, types, lint, format, deps, tests, standards)
```

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [rill-cli](https://github.com/rcrsr/rill-cli) — Build and bundle tooling (`rill run`, bundle mode)
- [rill-ext](https://github.com/rcrsr/rill-ext) — Vendor extensions

## License

MIT
