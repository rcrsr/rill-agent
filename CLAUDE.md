# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

pnpm workspace monorepo containing the agent framework for the [rill](https://github.com/rcrsr/rill) language runtime. Four published packages under `packages/agent/` plus one private shared package under `packages/shared/`. Packages are versioned independently.

| Package | NPM Name | Role |
|---------|----------|------|
| `agent/core` | `@rcrsr/rill-agent` | Manifest loader, `AgentRouter`, `validateParams`, `routerErrorToStatus` |
| `agent/http` | `@rcrsr/rill-agent-http` | Hono HTTP harness (`httpHarness`) |
| `agent/foundry` | `@rcrsr/rill-agent-foundry` | Foundry Responses API harness with SSE, Azure Conversations, OTEL |
| `agent/ahi` | `@rcrsr/rill-agent-ext-ahi` | Agent Host Interface extension for agent-to-agent invocation |
| `shared/hono-kit` | `@rcrsr/rill-agent-hono-kit` *(private)* | Shared Hono lifecycle and JSON assertion helpers used by `http` and `foundry` |

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
core  ← http     (dep)
core  ← foundry  (dep)
hono-kit ← http     (dep)
hono-kit ← foundry  (dep)
ahi
```

`core` (`@rcrsr/rill-agent`) is transport-agnostic and has no runtime dependency on `hono`. `http` (`@rcrsr/rill-agent-http`) and `foundry` (`@rcrsr/rill-agent-foundry`) each depend on `@rcrsr/rill-agent` and the private `@rcrsr/rill-agent-hono-kit`, and they carry the `hono` / `@hono/node-server` runtime dependencies. `ahi` uses `@rcrsr/rill` as a peer dependency and has no other workspace dependencies. `foundry` does not import `@rcrsr/rill` directly.

### Runtime Pipeline

The core workflow is: **manifest -> router -> harness -> serve**.

1. **core/manifest.ts** `loadManifest(dir)` auto-detects single-agent (`handler.js`), nested single-agent, or multi-agent (`manifest.json`) layouts and imports each `handler.js` module.
2. **core/router.ts** `createRouter(manifest, options?)` calls `describe()` on every handler, creates an AHI resolver, calls `init({ globalVars, ahiResolver })` concurrently, and returns an `AgentRouter`.
3. **http/src/index.ts** `httpHarness(router)` wraps the router in a Hono server exposing `GET /agents`, `POST /agents/:name/run`, and `POST /run`.
4. **foundry/harness.ts** `createFoundryHarness(router, options?)` is the alternative hosting entry point that speaks the Foundry Responses API.

### Transport Modes

The HTTP harness lives in its own package:
- `@rcrsr/rill-agent` — main (`loadManifest`, `createRouter`, types)
- `@rcrsr/rill-agent-http` — HTTP harness (`httpHarness`)

Foundry hosting lives in its own package: `@rcrsr/rill-agent-foundry` exposes `createFoundryHarness` and supporting helpers (sessions, conversations client, telemetry, response builders, SSE stream emitter).

### AHI (Agent-to-Agent Invocation)

The `ahi` extension registers `ahi::<agentName>` functions in the rill runtime context. The router builds an in-process AHI resolver that calls `router.run(agentName, request)` directly, so co-located agents skip HTTP. Remote agents resolve via static URLs.

## Conventions

- TypeScript strict mode with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- ESM only (`"type": "module"` in all packages)
- Tests in `packages/agent/*/tests/` using vitest (not in `src/`)
- Each vitest.config.ts aliases workspace packages to source for test-time resolution
- TypeScript project references via `tsconfig.base.json` with composite builds
- Shared eslint config at root `eslint.config.js`, referenced from each package
- Unused function parameters prefixed with `_` (eslint `argsIgnorePattern: '^_'`)

## Versioning and Release

Packages are versioned independently. Bump only the packages affected by a change.

**Minor version compatibility rule**: `@rcrsr/rill` and `@rcrsr/rill-ext-*` dependencies match by minor version. When rill bumps to `0.10.0`, packages that depend on rill bump to `0.10.0` and update those deps to `^0.10.0`.

To release: bump affected package versions, update changelogs, commit, then push a `v<version>` tag. CI (`.github/workflows/release.yml`) triggers on `v*` tags and publishes all non-private packages to npm (skipping versions already published).

## Documentation

Package docs live in `packages/agent/*/docs/`.
