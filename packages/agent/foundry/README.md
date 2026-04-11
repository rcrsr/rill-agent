# @rcrsr/rill-agent-foundry

Azure-hosted harness factory for the [rill](https://github.com/rcrsr/rill) agent framework. Wraps an `AgentRouter` in a Hono server that implements the Foundry Responses API protocol with SSE streaming, session persistence, and OpenTelemetry tracing. Outbound calls to Azure AI Foundry Conversations authenticate via `DefaultAzureCredential` (Entra ID).

## Install

```bash
npm install @rcrsr/rill-agent-foundry @opentelemetry/api
```

`@opentelemetry/api` is a required peer dependency.

## Quick Start

```typescript
import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import { createFoundryHarness } from '@rcrsr/rill-agent-foundry';

const manifest = await loadManifest('./build');
const router = await createRouter(manifest);

const harness = createFoundryHarness(router, { port: 8080 });

await harness.listen();
```

The harness exposes `POST /responses` and `POST /runs` for synchronous and streaming responses, plus `/liveness`, `/readiness`, and `/metrics` for operations.

## Documentation

- [Reference](docs/agent-foundry.md) — configuration, routes, streaming events, session storage, telemetry, error codes
- [How to deploy a rill agent to Azure AI Foundry](docs/deploy-foundry-agent.md) — end-to-end packaging, Dockerfile, ACR push, and registration script

## License

MIT
