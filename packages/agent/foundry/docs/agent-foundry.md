# Agent Foundry

*Azure-hosted harness factory implementing the Foundry Responses API protocol*

`@rcrsr/rill-agent-foundry` wraps an `AgentRouter` from `@rcrsr/rill-agent` in a Hono server that speaks the Foundry Responses API. It handles synchronous and streaming responses, session persistence via Azure AI Conversations, OpenTelemetry tracing, and Entra ID authentication.

## Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createFoundryHarness(router, options?)` | function | Build a `FoundryHarness` from an `AgentRouter` |
| `FoundryHarness` | type | `{ listen(), close(), app, metrics() }` |
| `FoundryHarnessOptions` | type | `port`, `maxConcurrentSessions`, `agentName`, `agentVersion`, `debugErrors`, `forceSync` |
| `FoundryMetrics` | type | Counters returned by `harness.metrics()` |
| `createSessionManager()` | function | In-memory session store used by the harness |
| `createConversationsClient(endpoint, credential)` | function | Azure AI Conversations REST client |
| `createIdGenerator()`, `generateId()` | function | Foundry-compatible ID generators |
| `extractInput(request)` | function | Pull `params` from a Foundry request body |
| `buildSyncResponse()`, `buildErrorResponse()`, `generateToolDefinitions()` | function | Response shape builders |
| `streamFoundryResponse()` | function | SSE stream emitter |
| `initTelemetry()`, `getTracer()`, `shutdownTelemetry()` | function | OpenTelemetry lifecycle |
| `CapacityError`, `CredentialError`, `InputError`, `PersistenceError` | class | Typed errors |

## Configuration

`FoundryHarnessOptions` is the second argument to `createFoundryHarness`. Every field has an environment-variable fallback.

| Option | Env var | Default | Description |
|--------|---------|---------|-------------|
| `port` | `PORT` | `8080` | TCP port |
| `agentName` | `FOUNDRY_AGENT_NAME` | `router.defaultAgent()` | Agent identifier in telemetry |
| `agentVersion` | `FOUNDRY_AGENT_VERSION` | unset | Version label in telemetry |
| `debugErrors` | `FOUNDRY_AGENT_DEBUG_ERRORS` | `false` | Surface stack traces in error responses |
| `forceSync` | `FOUNDRY_AGENT_FORCE_SYNC` | `false` | Disable SSE streaming for every request |
| `maxConcurrentSessions` | — | unlimited | Reject new sessions past the limit |

When `FOUNDRY_PROJECT_ENDPOINT` is set, the harness instantiates `DefaultAzureCredential` and a conversations client for session persistence. Without it, sessions live only in memory.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/responses` | Foundry Responses API entry point |
| `POST` | `/runs` | Alias for `/responses` |
| `GET` | `/liveness` | Always returns 200 |
| `GET` | `/readiness` | Returns 503 before init completes, 200 after |
| `GET` | `/metrics` | `FoundryMetrics` JSON |

Every response carries the `x-aml-foundry-agents-metadata` header required by the Foundry runtime.

## Request Handling

`POST /responses` accepts a Foundry `CreateResponse` body. The harness extracts `params` via `extractInput`, validates them against `router.describe(agentName).params`, and routes to `router.run(agentName, request)`. When the request opts into streaming and `forceSync` is `false`, the harness emits SSE events through `streamFoundryResponse`. Otherwise it returns a synchronous JSON response built by `buildSyncResponse`.

Streaming events follow the Foundry Responses event taxonomy: `response.created`, `response.output_item.added`, `response.output_text.delta`, `response.completed`, and `response.failed`. Errors emit a `StreamErrorEvent`.

## Session Persistence

`createSessionManager()` returns an in-memory store keyed by session ID. When an Azure project endpoint is configured, the harness mirrors session state to the Conversations REST API via `createConversationsClient`. Persistence failures throw `PersistenceError` and surface as a Foundry error response when `debugErrors` is enabled.

## Telemetry

`initTelemetry({ agentName, agentVersion })` boots the OpenTelemetry SDK with the OTLP HTTP trace exporter. Spans wrap each request with `SpanStatusCode.ERROR` on failure. `shutdownTelemetry()` flushes pending spans during `harness.close()`.

## Errors

| Error | HTTP | Cause |
|-------|------|-------|
| `InputError` | 400 | Missing or malformed request body |
| `CredentialError` | 401 | Azure credential acquisition failed |
| `CapacityError` | 429 | `maxConcurrentSessions` exceeded |
| `PersistenceError` | 500 | Conversations API write failed |
| Handler exception | 500 | Underlying agent threw |

When `debugErrors` is `true`, error responses include the original message and stack. Otherwise the harness returns a generic message and logs the detail through OpenTelemetry.

## Metrics

`harness.metrics()` returns `FoundryMetrics`:

```typescript
{
  totalRequests: number;
  errorCount: number;
  activeSessions: number;
}
```

Use these counters to drive Prometheus or Foundry's built-in scraper.
