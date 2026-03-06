## Monorepo Structure

rill-agent is a pnpm workspace containing the agent framework for the rill language runtime.

| Package | NPM Name | Role |
|---------|----------|------|
| `packages/agent/shared` | `@rcrsr/rill-agent-shared` | Types, validation, card generation |
| `packages/agent/harness` | `@rcrsr/rill-agent-harness` | HTTP server with lifecycle/metrics |
| `packages/agent/bundle` | `@rcrsr/rill-agent-bundle` | Manifest-to-bundle build tool |
| `packages/agent/run` | `@rcrsr/rill-agent-run` | CLI entry point for bundles |
| `packages/agent/build` | `@rcrsr/rill-agent-build` | Harness entry point generator |
| `packages/agent/proxy` | `@rcrsr/rill-agent-proxy` | Multi-agent routing proxy |
| `packages/agent/registry` | `@rcrsr/rill-agent-registry` | Service registry client |
| `packages/agent/ahi` | `@rcrsr/rill-agent-ext-ahi` | Agent-to-agent invocation extension |

## Commands

```bash
pnpm install             # Install dependencies
pnpm run -r build        # Build all packages
pnpm run -r test         # Run tests
pnpm run -r typecheck    # Type validation
pnpm run -r lint         # Check lint errors
pnpm run -r check        # Complete validation (build, test, lint)
```

Package-specific:

```bash
pnpm --filter @rcrsr/rill-agent-harness build
pnpm --filter @rcrsr/rill-agent-harness test
```

## Core Dependency

Agent packages consume `@rcrsr/rill` from npm (direct dependency, not peer).

## Release Process

All 8 agent packages share a synchronized version. Before release:

1. Update version in root `package.json`
2. Run `pnpm sync-versions` to propagate to all packages
3. Run `pnpm check-versions` to verify consistency
4. Run `./scripts/release.sh`

## Demo Apps

The `demo/` directory contains example agent applications: content-pipeline, data-cruncher, feedback-analyzer, tool-calling.

## Documentation

Docs for each package live in `packages/agent/*/docs/`.
