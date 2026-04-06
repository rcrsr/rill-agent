# rill-agent

[![CI](https://github.com/rcrsr/rill-agent/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/rcrsr/rill-agent/actions/workflows/pr-check.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/rcrsr/rill-agent)](https://github.com/rcrsr/rill-agent/blob/main/LICENSE)

Agent framework for [rill](https://github.com/rcrsr/rill). Production HTTP server, build tools, bundle system, and multi-agent proxy.

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](doc/getting-started.md) | Build and run your first agent |
| [Concepts](doc/concepts.md) | Manifests, composition, extensions, sessions, AHI |
| [Architecture](doc/architecture.md) | Package map, dependency graph, data flow |
| [Deployment](doc/deployment.md) | HTTP, stdio, serverless, Docker patterns |
| [CLI Reference](doc/cli-reference.md) | All commands and flags |

## Packages

### Core

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-agent-shared`](packages/agent/shared/docs/agent-shared.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-shared)](https://www.npmjs.com/package/@rcrsr/rill-agent-shared) | Types, validation, card generation |
| [`rill-agent-harness`](packages/agent/harness/docs/agent-harness.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-harness)](https://www.npmjs.com/package/@rcrsr/rill-agent-harness) | HTTP server with lifecycle and metrics |

### Build

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-agent-bundle`](packages/agent/bundle/docs/agent-bundle.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-bundle)](https://www.npmjs.com/package/@rcrsr/rill-agent-bundle) | Manifest-to-bundle build tool |
| [`rill-agent-build`](packages/agent/build/docs/agent-build.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-build)](https://www.npmjs.com/package/@rcrsr/rill-agent-build) | Harness entry point generator |
| [`rill-agent-run`](packages/agent/run/docs/agent-run.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-run)](https://www.npmjs.com/package/@rcrsr/rill-agent-run) | CLI entry point for bundles |

### Infrastructure

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-agent-proxy`](packages/agent/proxy/docs/agent-proxy.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-proxy)](https://www.npmjs.com/package/@rcrsr/rill-agent-proxy) | Multi-agent routing proxy |
| [`rill-agent-registry`](packages/agent/registry/) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-registry)](https://www.npmjs.com/package/@rcrsr/rill-agent-registry) | Service registry client |
| [`rill-agent-ext-ahi`](packages/agent/ahi/) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-ext-ahi)](https://www.npmjs.com/package/@rcrsr/rill-agent-ext-ahi) | Agent-to-agent invocation |

## Usage

```bash
npx @rcrsr/rill-agent-bundle init my-agent --extensions anthropic
cd my-agent
pnpm install
pnpm run build
```

## Versioning

All agent packages share a synchronized version. Every release bumps all packages to the same version number.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Demo Apps

The `demo/` directory contains example agents:

- `content-pipeline` — Multi-agent classifier, summarizer, orchestrator
- `data-cruncher` — Single-agent data processing
- `feedback-analyzer` — Feedback classification and routing
- `tool-calling` — Tool use patterns

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [rill-ext](https://github.com/rcrsr/rill-ext) — Vendor extensions

## License

MIT
