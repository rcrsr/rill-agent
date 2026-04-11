# @rcrsr/rill-agent-http

Hono-based HTTP harness for [`@rcrsr/rill-agent`](https://www.npmjs.com/package/@rcrsr/rill-agent). Wraps an `AgentRouter` in an HTTP server that exposes agent discovery and invocation endpoints.

## Install

```bash
npm install @rcrsr/rill-agent @rcrsr/rill-agent-http
```

## Quick Start

```typescript
import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import { httpHarness } from '@rcrsr/rill-agent-http';

const manifest = await loadManifest('./build');
const router = await createRouter(manifest, {
  globalVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
});

const harness = httpHarness(router);
await harness.listen(3000);
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List agents (`describe()` output) |
| `POST` | `/agents/:name/run` | Invoke a named agent |
| `POST` | `/run` | Invoke the manifest's default agent |

Request bodies match `RunRequest` from `@rcrsr/rill-agent`: `{ params?, timeout? }`. Responses return `RunResponse`: `{ state, result, streamed? }`.

## API

- `httpHarness(router)` — returns a `HttpHarness` wrapping the given `AgentRouter`
- `HttpHarness` — `{ app, listen(port), close() }`

## License

MIT
