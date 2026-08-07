# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rill Ecosystem

This repository is one piece of the broader rill ecosystem. See the ecosystem map at https://raw.githubusercontent.com/rcrsr/rill/refs/heads/main/llms-map.txt for an index of the wider documentation.

## Monorepo Structure

pnpm workspace monorepo containing the agent framework for the [rill](https://github.com/rcrsr/rill) language runtime. Five published packages under `packages/agent/` plus one private shared package under `packages/shared/`. Every publishable package sits at the same `major.minor` as the root manifest (see Versioning and Release).

| Package | NPM Name | Role |
|---------|----------|------|
| `agent/core` | `@rcrsr/rill-agent` | Manifest loader, `AgentRouter`, `validateParams`, `routerErrorToStatus` |
| `agent/http` | `@rcrsr/rill-agent-http` | Hono HTTP harness (`httpHarness`) |
| `agent/foundry` | `@rcrsr/rill-agent-foundry` | Foundry Responses API harness with SSE, Azure Conversations, OTEL |
| `agent/ahi` | `@rcrsr/rill-agent-ext-ahi` | Agent Host Interface extension for agent-to-agent invocation |
| `agent/chat` | `@rcrsr/rill-agent-chat` | OpenAI-compatible chat completions harness (SSE) |
| `shared/hono-kit` | `@rcrsr/rill-agent-hono-kit` *(private)* | Shared Hono lifecycle and JSON assertion helpers used by `http`, `foundry`, and `chat` |

## Commands

```bash
pnpm bootstrap              # verify toolchain, install (frozen), build — fresh clone
pnpm install                # install dependencies (also wires git hooks via prepare)
pnpm check                  # full validation aggregate (see below)
pnpm build                  # build the publishable packages (packages/**)
pnpm test                   # run all tests (vitest run)
pnpm check:types            # type validation across every package (tsc --noEmit)
pnpm check:lint             # lint (oxlint)
pnpm check:format           # formatting check (oxfmt)
pnpm check:deps             # unused dependencies and exports (knip)
pnpm check:versions         # every package at the root major.minor
pnpm check:standards        # repository conformance (@rcrsr/rill-dev)
pnpm fix:lint               # apply oxlint autofixes
pnpm fix:format             # reformat with oxfmt
pnpm fix:versions           # sync package versions to the root major.minor
```

`pnpm check` runs, in order: `check:versions`, `build`, `check:types`,
`check:lint`, `check:format`, `check:deps`, `test:rules`, `test`,
`check:standards`. It is the single entry point CI runs on every Node matrix
leg; `pnpm -r run check` would silently skip every root-only script.

Single package:

```bash
pnpm --filter @rcrsr/rill-agent build
pnpm --filter @rcrsr/rill-agent test
```

Single test file (run from package directory):

```bash
cd packages/agent/core && npx vitest run tests/router.test.ts
```

> The `demo/*` packages build with the external `rill` CLI (`rill build`), which
> is not a repository dependency, so `pnpm build` scopes to `packages/**` and
> does not build them. Build a demo from its own directory with the CLI
> installed.

## Architecture

### Dependency Graph

```
core  ← http     (dep)
core  ← foundry  (dep)
core  ← chat     (dep)
hono-kit ← http     (dep)
hono-kit ← foundry  (dep)
hono-kit ← chat     (dep)
ahi
```

`core` (`@rcrsr/rill-agent`) is transport-agnostic and has no runtime dependency on `hono`. `http` (`@rcrsr/rill-agent-http`), `foundry` (`@rcrsr/rill-agent-foundry`), and `chat` (`@rcrsr/rill-agent-chat`) each depend on `@rcrsr/rill-agent` and the private `@rcrsr/rill-agent-hono-kit`, and they carry the `hono` / `@hono/node-server` runtime dependencies. `ahi` uses `@rcrsr/rill` as a peer dependency and has no other workspace dependencies. `foundry` and `chat` do not import `@rcrsr/rill` directly.

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
- Lint with **oxlint** (`.oxlintrc.json`), format with **oxfmt** (`.oxfmtrc.json`); no eslint or prettier
- Unused function parameters prefixed with `_` (oxlint `argsIgnorePattern: '^_'`)
- Lint scope covers `src/` and `tests/` in every package

## Versioning and Release

Every publishable package sits at the same `major.minor` as the root
`package.json`, which is the version a release tag matches. Patch versions may
differ per package. `pnpm check:versions` (`scripts/check-versions.sh`) enforces
this and runs in CI and before publish; `pnpm fix:versions` reconciles a package
to the root major.minor.

**Minor version compatibility rule**: `@rcrsr/rill` and `@rcrsr/rill-ext-*`
dependencies match by minor version. When rill bumps to `0.10.0`, packages that
depend on rill bump to `0.10.0` and update those deps to `^0.10.0`. Dependabot
leaves `@rcrsr/rill` alone; its range is decided at release time.

To release: bump the affected package versions and the root version, run
`pnpm fix:versions`, update changelogs, commit, then push a `v<version>` tag. CI
(`.github/workflows/release.yml`) triggers on `v*` tags, verifies the tag equals
the root version and every package's major.minor, and publishes all non-private
`packages/agent/*` packages with provenance (skipping versions already
published).

## Repository standards

This repository conforms to the rill ecosystem standard, shipped as
[`@rcrsr/rill-dev`](https://www.npmjs.com/package/@rcrsr/rill-dev). The
authoritative index is `node_modules/@rcrsr/rill-dev/REPO-STANDARDS.md`
([online](https://github.com/rcrsr/rill/blob/main/packages/dev/REPO-STANDARDS.md)).
`pnpm check:standards` runs the checker; it is wired into `pnpm check` and CI.

**`--remote` is a maintainer step, never CI.** `rill-check-standards` runs
tree-only in CI: no `--remote`, no token. A pull request cannot change host
state (branch protection, repository settings), and `GITHUB_TOKEN` cannot read
branch protection anyway — the administrative fields are omitted from the
repository object and `branches/*/protection` answers 404, so every host element
reports unchecked. Gating merges on host state would turn every open PR red for
a reason no author can fix. Host elements are checked with
`pnpm check:standards --remote` from a maintainer's authenticated shell, where
the credentials already exist and no secret has to live in CI. Do not re-add the
flag to any workflow.

**Lint rule enablement** (`.oxlintrc.json`):

- `rill/no-spec-id-reference` is **on at `error` for `packages/*/src/`**
  (STD-LINT-3): internal planning identifiers (`AC-*`, `EC-*`, `IR-*`, …) must
  not leak into shipped source.
- `rill/no-duplicate-error-id` is **on at `error` for `src/`** as well: the `ahi`
  and `foundry` harnesses construct `RuntimeError` with `RILL-R*` ids, so the
  rule guards against a duplicate id (zero today).
- Four vitest/promise rules are **off**, matching the reference config
  (STD-LINT-9), each with its measured finding count recorded inline
  (STD-LINT-6).

**Recorded N/A and by-hand decisions** (elements the checker cannot decide from
the tree; each still applies):

- **STD-CI-2** — the Node matrix is `22, 24, 25`, the ecosystem-agreed set.
- **STD-SCRIPT-8** — canonical names are not reused: root uses `<verb>:<target>`
  aggregators, packages use the bare atomic names.
- **STD-LINT-6** — every disabled rule carries a measured count in
  `.oxlintrc.json`.
- **STD-PROC-1** — the `area:*` taxonomy lives on the host; apply it with
  `.github/scripts/sync-labels.sh`.
- **STD-PROC-4** — `issue-labels.yml` reads issue state fresh at execution time
  (GraphQL), never from the webhook payload.
- **STD-GATE-3 / STD-SET-1 / STD-SET-3** — host or cross-repository judgement;
  verified in the maintainer `--remote` run.

**Host settings requiring maintainer action** (from the `--remote` run; a PR
cannot change these):

- **STD-GATE-2** — branch protection must require the CI matrix contexts
  `check (22)`, `check (24)`, `check (25)`.
- **STD-GATE-5** — enable linear history and make squash the only merge path
  (disable merge-commit and rebase-merge).
- **STD-SET-2** — disable the repository wiki.
- **STD-SUP-6** — enable the dependency-graph host feature so
  `dependency-review.yml` can run.

## Documentation

Package docs live in `packages/agent/*/docs/`.
