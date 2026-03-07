# rill-agent

[![CI](https://github.com/rcrsr/rill-agent/actions/workflows/pr-check.yml/badge.svg)](https://github.com/rcrsr/rill-agent/actions/workflows/pr-check.yml)
[![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-harness)](https://www.npmjs.com/package/@rcrsr/rill-agent-harness)
[![Node](https://img.shields.io/node/v/@rcrsr/rill-agent-harness)](https://www.npmjs.com/package/@rcrsr/rill-agent-harness)
[![License](https://img.shields.io/github/license/rcrsr/rill-agent)](https://github.com/rcrsr/rill-agent/blob/main/LICENSE)

Agent framework for [rill](https://github.com/rcrsr/rill). Production HTTP server, build tools, bundle system, and multi-agent proxy.

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `agent/shared` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-shared)](https://www.npmjs.com/package/@rcrsr/rill-agent-shared) | Types, validation, card generation |
| `agent/harness` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-harness)](https://www.npmjs.com/package/@rcrsr/rill-agent-harness) | HTTP server with lifecycle and metrics |
| `agent/bundle` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-bundle)](https://www.npmjs.com/package/@rcrsr/rill-agent-bundle) | Manifest-to-bundle build tool |
| `agent/build` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-build)](https://www.npmjs.com/package/@rcrsr/rill-agent-build) | Harness entry point generator |
| `agent/run` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-run)](https://www.npmjs.com/package/@rcrsr/rill-agent-run) | CLI entry point for bundles |
| `agent/proxy` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-proxy)](https://www.npmjs.com/package/@rcrsr/rill-agent-proxy) | Multi-agent routing proxy |
| `agent/registry` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-registry)](https://www.npmjs.com/package/@rcrsr/rill-agent-registry) | Service registry client |
| `agent/ahi` | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-agent-ext-ahi)](https://www.npmjs.com/package/@rcrsr/rill-agent-ext-ahi) | Agent-to-agent invocation |

## Quick Start

```bash
npx @rcrsr/rill-agent-bundle init my-agent --extensions anthropic
cd my-agent
pnpm install
pnpm start
```

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
