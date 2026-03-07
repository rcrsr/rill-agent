# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

pnpm workspace monorepo containing the agent framework for the [rill](https://github.com/rcrsr/rill) language runtime. All 8 packages under `packages/agent/` share a synchronized version.

| Package | NPM Name | Role |
|---------|----------|------|
| `agent/shared` | `@rcrsr/rill-agent-shared` | Types, manifest validation (zod), card generation |
| `agent/harness` | `@rcrsr/rill-agent-harness` | HTTP server (Hono), lifecycle, metrics (prom-client), SSE |
| `agent/bundle` | `@rcrsr/rill-agent-bundle` | Manifest-to-bundle build tool (CLI) |
| `agent/build` | `@rcrsr/rill-agent-build` | Harness entry point code generator (CLI) |
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
registry ← ahi
registry ← harness (optional)
harness ← proxy
bundle ← proxy
```

All packages consume `@rcrsr/rill` from npm as a direct dependency (not peer), except `ahi` which uses it as a peer dependency.

### Composition Pipeline

The core workflow is: **manifest → compose → host → serve**.

1. **shared/schema.ts** defines `AgentManifest` and `HarnessManifest` schemas (zod validation)
2. **harness/compose.ts** has two entry points:
   - `composeAgent()` — single agent: resolves extensions, compiles custom functions (esbuild), parses `.rill` entry, returns `ComposedAgent`
   - `composeHarness()` — multi-agent: instantiates shared extensions once, composes each agent with merged shared + per-agent functions, returns `ComposedHarness`
3. **harness/host.ts** `createAgentHost()` — accepts single `ComposedAgent` or `Map<string, ComposedAgent>`, manages sessions, execution, metrics, and Hono HTTP routes
4. **harness/handler.ts** `createAgentHandler()` — serverless/Lambda entry point alternative to the HTTP host

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

1. **Minor version compatibility**: the dependency on `@rcrsr/rill` matches by minor version (e.g., `rill@0.9.x` works with any agent package at `0.9.y`). A rill minor bump requires a corresponding agent minor bump.
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
