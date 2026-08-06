# @rcrsr/rill-agent-chat

OpenAI-compatible chat completions harness for [`@rcrsr/rill-agent`](https://www.npmjs.com/package/@rcrsr/rill-agent). Wraps an `AgentRouter` in a Hono server that speaks the OpenAI Chat Completions wire format over Server-Sent Events (SSE). Stateless and provider-independent — no Azure or vendor SDK at runtime. Consumable by the openai SDK, LiteLLM, the Vercel AI SDK, and any HTTP client.

## Install

```bash
npm install @rcrsr/rill-agent @rcrsr/rill-agent-chat
```

## Quick Start

```typescript
import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import { createChatHarness } from '@rcrsr/rill-agent-chat';

const manifest = await loadManifest('./build');
const router = await createRouter(manifest);

const harness = createChatHarness(router);
await harness.listen(3000);
```

An agent is chat-eligible when its handler returns a stream of OpenAI-shaped chunks. See [the reference](docs/agent-chat.md) for the handler contract and `inspectChatHandler`.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible; the `model` field selects the agent |
| `POST` | `/agents/:name/chat` | Per-agent chat |
| `POST` | `/chat` | Default agent chat |
| `GET` | `/agents` | List chat-eligible agents |
| `GET` | `/health` | Liveness (always on) |
| `GET` | `/metrics` | Request counters (always on) |

Request and response bodies follow the OpenAI Chat Completions format. Set `"stream": true` for an SSE stream of `chat.completion.chunk` events. Toggle the first four routes via `options.routes`.

## API

- `createChatHarness(router, options?)` — returns a `ChatHarness` (`{ app, listen(port), close() }`)
- `inspectChatHandler(handler)` — reports whether a handler is chat-eligible
- `validateMessages(messages)` — validates an incoming messages array

The default export is a `RillHarness` adapter consumed by the rill CLI bundle mode (`rill run`) when this package is declared as a bundle harness.

## Documentation

- [Reference](docs/agent-chat.md) — routes, options, the handler contract, streaming, and error shapes

## License

MIT
