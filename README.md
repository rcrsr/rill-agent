# rill-agent

[![CI](https://github.com/rcrsr/rill-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rcrsr/rill-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/rcrsr/rill-agent)](https://github.com/rcrsr/rill-agent/blob/main/LICENSE)

Host framework that turns compiled [rill](https://github.com/rcrsr/rill) scripts into callable agents. A rill script becomes an `AgentHandler` exposing `describe`, `init`, `execute`, and `dispose`. The runtime loads one or more handlers from a manifest, builds a router that wires up agent-to-agent invocation, and serves the router over HTTP or through a third-party agent framework integration.

Azure AI Foundry is the first supported third-party agent framework, via [`@rcrsr/rill-agent-foundry`](packages/agent/foundry), which speaks the Foundry Responses API and adds session persistence, SSE streaming, and OTEL observability. Additional framework integrations will follow.

Use this repo when you have a rill script and want to run it as a long-lived service with parameter validation and agent routing. The core HTTP harness provides request and parameter validation plus a single JSON response path; features such as session persistence, streaming responses, and observability depend on the hosting integration you choose. Single-agent and multi-agent deployments use the same router. Co-located agents call each other in-process; remote agents resolve via static URLs.

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](doc/getting-started.md) | Build and run your first agent |
| [Concepts](doc/concepts.md) | Manifests, composition, extensions, sessions, AHI |
| [Architecture](doc/architecture.md) | Package map, dependency graph, data flow |
| [Deployment](doc/deployment.md) | HTTP, stdio, serverless, Docker patterns |
| [CLI Reference](doc/cli-reference.md) | All commands and flags |

## Packages

All packages are published under `@rcrsr/` on npm and share a synchronized version.

| Category | Package | npm | Docs | Description |
|----------|---------|-----|------|-------------|
| **Runtime** | [`rill-agent`](packages/agent/core) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent)](https://www.npmjs.com/package/@rcrsr/rill-agent) | [docs](packages/agent/core/docs/agent-core.md) | Manifest loader and router |
| **Runtime** | [`rill-agent-http`](packages/agent/http) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-http)](https://www.npmjs.com/package/@rcrsr/rill-agent-http) | [docs](packages/agent/core/docs/agent-core.md) | HTTP harness for `AgentRouter` |
| **Hosting** | [`rill-agent-foundry`](packages/agent/foundry) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-foundry)](https://www.npmjs.com/package/@rcrsr/rill-agent-foundry) | [docs](packages/agent/foundry/docs/agent-foundry.md) | Azure Foundry Responses API harness |
| **Extensions** | [`rill-agent-ext-ahi`](packages/agent/ahi) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-ext-ahi)](https://www.npmjs.com/package/@rcrsr/rill-agent-ext-ahi) | [docs](packages/agent/ahi/docs/agent-ahi.md) | Agent-to-agent invocation |

## Usage

```typescript
import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import { httpHarness } from '@rcrsr/rill-agent-http';

const manifest = await loadManifest('./build');
const router = await createRouter(manifest);
const harness = httpHarness(router);
await harness.listen(3000);
```

## Versioning

All agent packages share a synchronized version. Every release bumps all packages to the same version number.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [rill-ext](https://github.com/rcrsr/rill-ext) — Vendor extensions

## License

MIT
