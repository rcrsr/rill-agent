# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.18.4] - 2026-04-05

### Changed

- Composition pipeline uses rill-config.json format instead of separate manifest schemas
- TypeScript 5.9.3 → 6.0.2 (added explicit `types: ["node"]` in tsconfig.base.json)
- esbuild 0.27.7 → 0.28.0
- hono 4.12.5 → 4.12.10, @hono/node-server 1.19.11 → 1.19.12
- vitest 4.0.18 → 4.1.2, eslint 10.0.2 → 10.2.0
- @rcrsr/rill pinned to ^0.18.4, @rcrsr/rill-config to ^0.18.4
- Demo apps updated from ^0.9.0 to ^0.18.0 for @rcrsr/rill and @rcrsr/rill-ext-openai
- Node minimum raised to >=22.0.0; CI matrix tests Node 22, 24, 25
- Compatibility workflow installs latest compatible @rcrsr/rill instead of @latest

### Added

- `rill-config-migration`: bundle, harness, run, proxy, and shared all read rill-config.json
- Handler entry point (`@rcrsr/rill-agent-harness/handler.ts`) for serverless/Lambda
- Deferred context resolution in compose and host
- New tests: compose-deferred, host-deferred, rill-config-lifecycle, CLI tests for bundle/run
- Documentation: architecture, concepts, CLI reference, deployment, getting-started, migration guide
- Demo READMEs for content-pipeline and tool-calling
- `pnpm.onlyBuiltDependencies` for esbuild in root package.json

## [0.9.0] - 2026-03-06

Initial release as independent repository, extracted from [rcrsr/rill](https://github.com/rcrsr/rill).

### Packages

- `@rcrsr/rill-agent-shared` — Types, manifest validation, card generation
- `@rcrsr/rill-agent-harness` — HTTP server, lifecycle, metrics, SSE
- `@rcrsr/rill-agent-bundle` — Manifest-to-bundle build tool (CLI)
- `@rcrsr/rill-agent-build` — Harness entry point code generator (CLI)
- `@rcrsr/rill-agent-run` — CLI runner for agent bundles
- `@rcrsr/rill-agent-proxy` — Multi-agent routing proxy (CLI)
- `@rcrsr/rill-agent-registry` — Service registry client
- `@rcrsr/rill-agent-ext-ahi` — Agent Host Interface for agent-to-agent invocation
