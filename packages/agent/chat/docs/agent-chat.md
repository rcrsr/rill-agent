# @rcrsr/rill-agent-chat

*OpenAI-compatible chat completions harness for rill agents*

`@rcrsr/rill-agent-chat` wraps an `AgentRouter` from `@rcrsr/rill-agent` in a Hono server that speaks the OpenAI Chat Completions wire format over Server-Sent Events (SSE). It is stateless and provider-independent — no Azure, no vendor SDK required at runtime.

The package exposes a single factory, `createChatHarness`, that registers configurable routes, manages per-request `AbortSignal` propagation, and collects lightweight request counters. Handlers return an `AsyncIterable<ChatChunk>` or a `ReadableStream<ChatChunk>`; the harness handles SSE framing and client disconnects automatically.

All routes can be toggled independently via `options.routes`. Two observability routes (`/health` and `/metrics`) are always registered and cannot be disabled.

## Installation

```bash
pnpm add @rcrsr/rill-agent @rcrsr/rill-agent-chat
```

## Quick start

```typescript
import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import { createChatHarness } from '@rcrsr/rill-agent-chat';

const manifest = await loadManifest('./agents');
const router = await createRouter(manifest);
const harness = createChatHarness(router);
await harness.listen(3000);
```

`createChatHarness` is synchronous. Call `listen()` separately to bind to a port.

## Bundle harness (rill 0.20)

The package's default export is a rill-CLI `RillHarness`, so a bundle can host
its agents with `rill run` instead of a hand-wired host. Declare the harness in
`rill-bundle.json`:

```json
{
  "name": "my-bundle",
  "version": "0.0.0",
  "harness": "@rcrsr/rill-agent-chat",
  "config": { "port": 3000 },
  "packages": [{ "mount": "my-agent", "project": "." }]
}
```

```bash
rill install @rcrsr/rill-agent-chat --replace   # role: "harness" gate
rill run                                          # build + serve on config.port
```

`serve` assembles a router from the bundle's compiled packages (agent name =
mount) and hosts it on `config.port` (default 3000); `postBuild` asserts each
package emitted `handler.js`.

## Writing a chat handler

Author the agent in rill. Bind a streaming closure to `$chat`; `rill-build` compiles the script into an `AgentHandler` whose declared signature the harness validates via `describe()`, then invokes per request through `execute({ params: { messages } }, { onChunk })`. The closure receives the messages and must emit zero or more `ChatChunk` dicts via `yield`.

**main.rill** (echo agent — streams the last user message back as a single chunk):

```rill
^("Echo the last user message")(messages: list[dict]) || {
  $messages -> .last => $last
  $last.?content ?? "" => $text

  [
    choices: [[
      delta: [role: "assistant", content: $text],
      finish_reason: "stop"
    ]]
  ] -> yield
}:stream(dict):#null => $chat
```

**rill-config.json**:

```json
{
  "name": "echo",
  "version": "0.1.0",
  "main": "main.rill:chat"
}
```

Build with `npx rill-build . --output build`. `loadManifest('./build')` then picks up the agent and the chat harness validates that the compiled handler exposes `chat()`.

A streaming LLM agent follows the same shape — pipe each token from a streaming extension into `yield`, then emit a terminal chunk with `finish_reason: "stop"`:

```rill
^("Stream LLM tokens to the client")(messages: list[dict]) || {
  use<ext:ai> => $ai

  $ai.message_stream($messages) => $tokens

  $tokens -> seq({
    [
      choices: [[
        delta: [content: $],
        finish_reason: #null
      ]]
    ] -> yield
  })

  [
    choices: [[
      delta: [],
      finish_reason: "stop"
    ]]
  ] -> yield
}:stream(dict):#null => $chat
```

The `model` field on the inbound request reaches the harness for agent selection on `/v1/chat/completions`; the rill script sees only the `messages` parameter and any other fields it declares.

See the [rill streams guide](https://rill.run/docs/guide-examples-streams) for `yield`, `seq`, and `:stream(T):R` semantics, and the [agent build guide](https://rill.run/docs/guide-make) for the full project layout.

## Exposed routes

| Endpoint | Method | Configurable via | Purpose |
|----------|--------|------------------|---------|
| `/v1/chat/completions` | POST | `options.routes.openai` | OpenAI Chat Completions; `model` field selects agent |
| `/agents/:name/chat` | POST | `options.routes.perAgent` | Per-agent chat endpoint |
| `/chat` | POST | `options.routes.defaultAgent` | Default agent shortcut |
| `/agents` | GET | `options.routes.discovery` | Returns chat-eligible agents only |
| `/health` | GET | No | Health check; always 200 |
| `/metrics` | GET | No | `{ requests, errors, active_connections }` JSON |

All configurable routes default to enabled. Pass `false` to disable individual routes.

## Options reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `options.port` | `number` | `3000` | Listen port used by `harness.listen()` when no port argument is passed |
| `options.cors` | `boolean` | `false` | Enable CORS middleware on all routes |
| `options.routes.openai` | `boolean` | `true` | Register `POST /v1/chat/completions` |
| `options.routes.perAgent` | `boolean` | `true` | Register `POST /agents/:name/chat` |
| `options.routes.defaultAgent` | `boolean` | `true` | Register `POST /chat` |
| `options.routes.discovery` | `boolean` | `true` | Register `GET /agents` |

Example — disable the OpenAI-compatible route and enable CORS:

```typescript
const harness = createChatHarness(router, {
  cors: true,
  routes: { openai: false },
});
```

## AHI integration

Agent-to-agent invocation (AHI) is provided by the `@rcrsr/rill-agent-ext-ahi` extension, not by the chat harness. When the router is built with that extension, sibling agents are reachable in-process — no HTTP round-trip — from within a rill agent handler via the runtime's `ahi::<agentName>(...)` functions, wired at `createRouter()` init time. The chat harness does not pass an AHI handle per request; co-located agents resolve AHI through the resolver captured at router init, independent of any given chat request.

See the `@rcrsr/rill-agent-ext-ahi` package documentation for the `ahi::<agentName>(...)` call idiom and extension setup.

## Error model

### Factory-time errors

These are thrown synchronously by `createChatHarness` before the server starts.

| Error | Cause |
|-------|-------|
| `TypeError('router is required')` | `router` argument is `null` or `undefined` |
| `ChatSignatureError` | `options.routes.defaultAgent` is enabled but the default agent is missing or lacks a `chat()` method |

### Request-time errors

| Error | HTTP | Cause |
|-------|------|-------|
| `ChatValidationError` | 400 | `messages` array is missing, empty, or contains invalid entries |
| `ChatNotFoundError` | 404 | Request targets an agent name that does not exist or is not chat-eligible |
| Handler exception (pre-first-chunk) | 500 JSON | Handler throws synchronously or rejects before yielding any chunk |
| Handler exception (post-first-chunk) | In-band SSE error frame | Handler throws after streaming has begun; the harness emits a final SSE error event followed by `data: [DONE]` |

Pre-first-chunk errors return a JSON body:

```json
{ "error": { "message": "description of the problem" } }
```

Post-first-chunk errors arrive as an SSE event after the partial stream:

```
data: {"choices":[{"delta":{},"finish_reason":"error"}]}\n\n
data: [DONE]\n\n
```

## Client compatibility

The harness speaks the standard OpenAI SSE wire format. Each chunk is a JSON object prefixed with `data: ` and separated by `\n\n`. The stream ends with `data: [DONE]\n\n`.

Confirmed compatible clients:

- **openai SDK** (`openai` npm package) — pass `baseURL` pointing at the harness
- **LiteLLM** — set the model prefix and `api_base`
- **Vercel AI SDK** (`ai` npm package) — use `createOpenAI` with a custom base URL
- **curl** — `curl -N -X POST http://localhost:3000/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"echo","messages":[{"role":"user","content":"hello"}],"stream":true}'`

## Observability

### Health

`GET /health` returns HTTP 200 with the plain-text body `OK` whenever the process is running. It does not check agent initialization state.

### Metrics

`GET /metrics` returns a JSON object:

```json
{
  "requests": 42,
  "errors": 1,
  "active_connections": 3
}
```

| Counter | Description |
|---------|-------------|
| `requests` | Total completed requests (incremented when the stream closes, not when it opens) |
| `errors` | Total requests that produced an error response |
| `active_connections` | Requests currently streaming; decremented when the stream closes or the client disconnects |

These counters reset when the process restarts. Use a Prometheus push-gateway or scrape `/metrics` periodically to persist them.
