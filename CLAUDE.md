# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

pnpm workspace monorepo containing the agent framework for the [rill](https://github.com/rcrsr/rill) language runtime. All 5 packages under `packages/agent/` share a synchronized version.

| Package | NPM Name | Role |
|---------|----------|------|
| `agent/core` | `@rcrsr/rill-agent` | Manifest loader, `AgentRouter`, Hono HTTP harness (`/http` subpath) |
| `agent/shared` | `@rcrsr/rill-agent-shared` | Types, manifest validation (zod), card generation |
| `agent/foundry` | `@rcrsr/rill-agent-foundry` | Foundry Responses API harness with SSE, Azure Conversations, OTEL |
| `agent/registry` | `@rcrsr/rill-agent-registry` | Service registry client for publish/resolve |
| `agent/ahi` | `@rcrsr/rill-agent-ext-ahi` | Agent Host Interface extension for agent-to-agent invocation |

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
pnpm --filter @rcrsr/rill-agent build
pnpm --filter @rcrsr/rill-agent test
```

Single test file (run from package directory):

```bash
cd packages/agent/core && npx vitest run tests/router.test.ts
```

## Architecture

### Dependency Graph

```
shared
core ← foundry (peer)
registry
ahi
```

`core` (`@rcrsr/rill-agent`) is self-contained and depends only on `hono` and `@hono/node-server`. `shared` provides types and validation utilities. `ahi` uses `@rcrsr/rill` as a peer dependency. `foundry` consumes `@rcrsr/rill-agent` as a peer dependency and does not import `@rcrsr/rill` directly.

### Runtime Pipeline

The core workflow is: **manifest -> router -> harness -> serve**.

1. **core/manifest.ts** `loadManifest(dir)` auto-detects single-agent (`handler.js`), nested single-agent, or multi-agent (`manifest.json`) layouts and imports each `handler.js` module.
2. **core/router.ts** `createRouter(manifest, options?)` calls `describe()` on every handler, creates an AHI resolver, calls `init({ globalVars, ahiResolver })` concurrently, and returns an `AgentRouter`.
3. **core/harness/http.ts** `httpHarness(router)` wraps the router in a Hono server exposing `GET /agents`, `POST /agents/:name/run`, and `POST /run`.
4. **foundry/harness.ts** `createFoundryHarness(router, options?)` is the alternative hosting entry point that speaks the Foundry Responses API.

### Transport Modes

Core exports two entry points:
- `@rcrsr/rill-agent` — main (`loadManifest`, `createRouter`, types)
- `@rcrsr/rill-agent/http` — HTTP harness (`httpHarness`)

Foundry hosting lives in its own package: `@rcrsr/rill-agent-foundry` exposes `createFoundryHarness` and supporting helpers (sessions, conversations client, telemetry, response builders, SSE stream emitter).

### AHI (Agent-to-Agent Invocation)

The `ahi` extension registers `ahi::<agentName>` functions in the rill runtime context. The router builds an in-process AHI resolver that calls `router.run(agentName, request)` directly, so co-located agents skip HTTP. Remote agents resolve via static URLs or the registry client.

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

1. **Minor version compatibility**: `@rcrsr/rill` and `@rcrsr/rill-ext-*` dependencies match by minor version. When rill bumps to `0.10.0`, agent packages bump to `0.10.0` and update rill and rill-ext deps to `^0.10.0`.
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
