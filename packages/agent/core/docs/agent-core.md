# Agent Core

*Manifest loading, agent routing, and HTTP harness for the rill agent framework*

`@rcrsr/rill-agent` is the runtime that hosts compiled agent handlers. It loads a manifest from disk, builds an `AgentRouter` that wires up agent-to-agent invocation, and exposes the router over HTTP via a Hono-based harness.

## Exports

### Main entry — `@rcrsr/rill-agent`

| Export | Kind | Description |
|--------|------|-------------|
| `loadManifest(dir)` | function | Load a manifest from a directory (auto-detects single or multi-agent layout) |
| `createRouter(manifest, options?)` | function | Build an `AgentRouter` and call `init()` on every handler |
| `AgentHandler` | type | The four-method contract a handler module must export |
| `AgentManifest` | type | `{ defaultAgent, agents }` map produced by `loadManifest` |
| `AgentRouter` | type | Router with `run`, `describe`, `agents`, `defaultAgent`, `dispose` |
| `HandlerDescription` | type | Static handler metadata returned by `describe()` |
| `InitContext` | type | Init payload: `globalVars`, `ahiResolver` |
| `RunRequest` | type | `{ params?, timeout? }` |
| `RunContext` | type | `{ sessionVars?, onLog?, onChunk? }` |
| `RunResponse` | type | `{ state, result, streamed? }` |

### HTTP entry — `@rcrsr/rill-agent/http`

| Export | Kind | Description |
|--------|------|-------------|
| `httpHarness(router)` | function | Wrap an `AgentRouter` in a Hono server |
| `HttpHarness` | type | `{ listen(port?), close(), app }` |

## Handler Contract

Every handler module must export four functions matching the `AgentHandler` interface:

```typescript
export function describe(): HandlerDescription | null;
export function init(context?: InitContext): Promise<void>;
export function execute(request?: RunRequest, context?: RunContext): Promise<RunResponse>;
export function dispose(): Promise<void>;
```

`describe()` returns the static type information used for parameter validation. It runs before `init()` and may return `null` to opt out of validation. `init()` receives global variables and an AHI resolver. `execute()` runs the agent. `dispose()` releases resources.

## Manifest Loading

`loadManifest(dir)` resolves an absolute path and probes three layouts in order:

1. **Multi-agent**: `dir/manifest.json` lists agents by name and points each at a subdirectory containing `handler.js`.
2. **Single-agent**: `dir/handler.js` exists; the agent name comes from `describe().name` or the directory basename.
3. **Single-agent nested**: one level deeper, `dir/<sub>/handler.js` exists.

A multi-agent `manifest.json` has the shape:

```json
{
  "default": "classifier",
  "agents": {
    "classifier": "classifier",
    "summarizer": "summarizer"
  }
}
```

When `default` is omitted and only one agent is registered, that agent becomes the default.

## Router Behavior

`createRouter(manifest, options?)` performs four steps:

1. Calls `describe()` on every handler and caches the result.
2. Builds an AHI resolver that closes over the router's own `run` function.
3. Calls `init({ globalVars, ahiResolver })` on every handler concurrently with `Promise.all`.
4. Returns the router object.

`router.run(name, request, context?)` resolves an empty name to the default agent, throws when the agent is unknown, normalizes `params` to `{}` when missing, and forwards to `handler.execute()`. AHI calls do not forward the caller's `RunContext`; agent-to-agent invocations always run with a fresh context.

`router.dispose()` calls `dispose()` on every handler in registration order.

## HTTP Routes

`httpHarness(router)` returns a `HttpHarness` exposing three routes on a Hono app:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List agents with `name`, `description`, and `default` flag |
| `POST` | `/agents/:name/run` | Run a named agent |
| `POST` | `/run` | Run the default agent |

Request bodies for `/run` endpoints accept a JSON object that becomes the `RunRequest`. Parameters are validated against the handler's `describe().params` before invocation. Validation enforces required parameters and primitive type matching for `string`, `number`, `bool`, `dict`, and `list`. Type `any` skips validation.

`harness.listen(port?)` starts the Node server. `harness.close()` stops it. `harness.app` exposes the underlying Hono instance for adding custom middleware or routes.

## Errors

Validation failures return HTTP 400 with `{ error: <message> }`. Unknown agents return HTTP 404. Handler exceptions surface as HTTP 500 with the error message in the body.
