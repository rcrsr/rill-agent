# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

pnpm workspace monorepo containing the agent framework for the [rill](https://github.com/rcrsr/rill) language runtime. All 9 packages under `packages/agent/` share a synchronized version.

| Package | NPM Name | Role |
|---------|----------|------|
| `agent/shared` | `@rcrsr/rill-agent-shared` | Types, manifest validation (zod), card generation |
| `agent/harness` | `@rcrsr/rill-agent-harness` | HTTP server (Hono), lifecycle, metrics (prom-client), SSE |
| `agent/bundle` | `@rcrsr/rill-agent-bundle` | Manifest-to-bundle build tool (CLI) |
| `agent/build` | `@rcrsr/rill-agent-build` | Harness entry point code generator (CLI) |
| `agent/foundry` | `@rcrsr/rill-agent-foundry` | Foundry Responses API protocol adapter |
| `agent/run` | `@rcrsr/rill-agent-run` | CLI runner for agent bundles |
| `agent/proxy` | `@rcrsr/rill-agent-proxy` | Multi-agent routing proxy (CLI) |
| `agent/registry` | `@rcrsr/rill-agent-registry` | Service registry client |
| `agent/ahi` | `@rcrsr/rill-agent-ext-ahi` | Agent Host Interface (AHI) extension for agent-to-agent invocation |

Demo apps live in `demo/` (content-pipeline, data-cruncher, feedback-analyzer, tool-calling).

## Commands

```bash
pnpm install                # install dependencies
pnpm run -r build           # build all packages (tsc --build)
pnpm run -r test            # run all tests (vitest run)
pnpm run -r typecheck       # type validation (tsc --noEmit)
pnpm run -r lint            # eslint check
pnpm run -r check           # full validation: build + test + lint
```

Single package:

```bash
pnpm --filter @rcrsr/rill-agent-harness build
pnpm --filter @rcrsr/rill-agent-harness test
```

Single test file (run from package directory):

```bash
cd packages/agent/harness && npx vitest run tests/host-lifecycle.test.ts
```

## Architecture

### Dependency Graph

```
shared ← harness ← bundle ← run
shared ← build              ← proxy
shared ← registry (peer)
shared ← ahi
core ← foundry (peer)
registry ← ahi
registry ← harness (optional)
harness ← proxy
bundle ← proxy
```

All packages consume `@rcrsr/rill` from npm as a direct dependency (not peer), except `ahi` which uses it as a peer dependency. The `foundry` package depends on `@rcrsr/rill-agent` (workspace) and does not import `@rcrsr/rill` directly.

### Composition Pipeline

The core workflow is: **rill-config.json -> compose -> host -> serve**.

1. **harness/compose.ts** has two entry points:
   - `composeAgent()` — single agent: loads `rill-config.json` via `@rcrsr/rill-config`, resolves extensions, parses `.rill` entry, returns `ComposedAgent`
   - `composeHarness()` — multi-agent: loads each agent from its own `rill-config.json` directory, returns `ComposedHarness`
2. **harness/host.ts** `createAgentHost()` — accepts single `ComposedAgent` or `Map<string, ComposedAgent>`, manages sessions, execution, metrics, and Hono HTTP routes
3. **harness/handler.ts** `createAgentHandler()` — serverless/Lambda entry point alternative to the HTTP host

### Transport Modes

Harness exports multiple sub-path entry points:
- `@rcrsr/rill-agent-harness` — main (createAgentHost, composeAgent)
- `@rcrsr/rill-agent-harness/http` — HTTP transport
- `@rcrsr/rill-agent-harness/stdio` — stdio protocol with AHI bridge
- `@rcrsr/rill-agent-harness/gateway` — API Gateway adapter
- `@rcrsr/rill-agent-harness/worker` — worker transport

### AHI (Agent-to-Agent Invocation)

The `ahi` extension registers `ahi::<agentName>` functions in the runtime context. In-process routing (`compose.ts:bindHost()`) replaces these with direct callables when agents are co-located in the same harness. Remote routing falls back to HTTP.

### Proxy

The proxy process-manages multiple agent bundles, routes requests via catalog lookup, and mediates AHI calls between agents across processes.

## Conventions

- TypeScript strict mode with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- ESM only (`"type": "module"` in all packages)
- Tests in `packages/agent/*/tests/` using vitest (not in `src/`)
- Each vitest.config.ts aliases workspace packages to source for test-time resolution
- TypeScript project references via `tsconfig.base.json` with composite builds
- Shared eslint config at root `eslint.config.js`, referenced from each package
- Unused function parameters prefixed with `_` (eslint `argsIgnorePattern: '^_'`)

## Versioning and Release

All packages share an identical version number and use semver with two rules:

1. **Minor version compatibility**: `@rcrsr/rill` and `@rcrsr/rill-ext-*` dependencies match by minor version. When rill bumps to `0.10.0`, agent packages bump to `0.10.0` and update rill and rill-ext deps to `^0.10.0`. Demo apps follow the same rule.
2. **Patch version per change**: bump the patch version for each publish, regardless of change size.

```bash
# Update version in root package.json, then:
pnpm sync-versions     # propagate to all packages
pnpm check-versions    # verify consistency
./scripts/release.sh   # validate, tag, push (CI publishes)
```

CI triggers on `v*` tags and publishes all non-private packages to npm.

## Documentation

Package docs live in `packages/agent/*/docs/`.
