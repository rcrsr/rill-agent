# chat-echo

A minimal rill agent that exposes itself over `@rcrsr/rill-agent-chat`. The agent echoes the last user message back as a single OpenAI-shaped chat chunk.

## Layout

```
main.rill           # rill source — fully-typed stream closure bound to $chat
rill-config.json    # rill project config
server.js           # loads manifest, builds router, starts chat harness
package.json        # workspace package
build/              # rill-build output (gitignored)
.rill/              # rill bootstrap scaffolding (gitignored)
```

## Prerequisites

- Node.js ≥ 22
- `pnpm` for the workspace install
- `@rcrsr/rill-cli` ≥ 0.19.6 on `PATH` (paired with `@rcrsr/rill` ≥ 0.19.3) — earlier releases do not emit positional arg bindings or the `returnType` introspection that `inspectChatHandler` requires.

```bash
npm i -g @rcrsr/rill-cli      # or upgrade if you already have it
rill --version                # → rill-cli 0.19.6 (runtime 0.19.3) or newer
```

## Run

From the repo root:

```bash
pnpm install
pnpm --filter chat-echo build      # runs `rill build --output build`
pnpm --filter chat-echo start      # node server.js, listens on PORT (default 3000)
```

Rebuild only when `main.rill` or `rill-config.json` changes. Override the port with the `PORT` env var.

## Test

```bash
# OpenAI Chat Completions route — `model` selects the agent
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"chat-echo","messages":[{"role":"user","content":"hello rill"}]}'

# Default-agent shortcut
curl -N -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'

# Per-agent route
curl -N -X POST http://localhost:3000/agents/chat-echo/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'

# Discovery, health, metrics
curl http://localhost:3000/agents
curl http://localhost:3000/health
curl http://localhost:3000/metrics
```

Each chat call returns an SSE stream:

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1700000000,"model":"chat-echo","choices":[{"delta":{"role":"assistant","content":"hello rill"},"finish_reason":"stop"}]}

data: [DONE]
```

## How it works

`main.rill` declares the full chat signature on a single stream closure bound to `$chat`:

```rill
|messages: list(dict(role: string, content: string))| {
  $messages[-1] => $last
  $last.content => $text

  [
    choices: [[
      delta: [role: "assistant", content: $text],
      finish_reason: "stop"
    ]]
  ] -> yield

  $text
}:stream(dict(choices: list(dict(delta: dict(role: string, content: string), finish_reason: string)))):string => $chat
```

1. `rill build` compiles `main.rill` into `build/chat-echo/handler.js` exposing `describe / init / execute / dispose`. Static introspection embeds the closure's params and return type into `describe()` so the chat harness can validate the signature before any request.
2. `execute()` maps `request.params.messages` to the closure's positional `messages: list(dict(role: string, content: string))` argument, invokes the rill stream closure, and forwards each yielded chunk to the chat harness through the `onChunk` callback in `RunContext`.
3. `server.js` calls `loadManifest('./build')` (auto-detects `build/chat-echo/handler.js`), builds an `AgentRouter`, and hands it to `createChatHarness`. The harness validates the default agent via `handler.describe()` — it requires `messages: list(dict(role: string, content: string))` and a stream chunk of `dict(choices: list(dict(delta: dict(role: string, content: string), finish_reason: string)))`; a mismatch throws `ChatSignatureError` at construction. It then registers the four configurable routes plus `/health` and `/metrics`.
4. On each chat request the harness calls `handler.execute({ params: { messages } }, { onChunk })`, wraps the chunks into a `ReadableStream<ChatChunk>`, fills in `id / object / created / model`, and ships them over SSE.
