# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- HTTP server hosting is now a separate optional package; core agent framework no longer bundles HTTP transport code

## [0.18.5] - 2026-04-09

### Removed

- `@rcrsr/rill-agent-shared` package (types and validation utilities no longer needed by `core` or `foundry`; types required by `ahi` are inlined into the package)
- `@rcrsr/rill-agent-registry` package (registry client removed together with AHI registry mode)
- AHI registry-mode resolution (`agents: string[]` with a `registry` URL is no longer accepted; use static URL mode only)

### Changed

- `@rcrsr/rill-agent-ext-ahi` no longer imports from `@rcrsr/rill-agent-shared` or `@rcrsr/rill-agent-registry`. `ExtensionResult`, `InputSchema`, and `InProcessRunner` are now defined locally in the package.
- Consolidated build, bundle, harness, proxy, and run packages into single `@rcrsr/rill-agent` core package
- Replaced demo apps with agentic-news-digest
- TypeScript 5.9.3 → 6.0.2 (added explicit `types: ["node"]` in tsconfig.base.json)
- esbuild 0.27.7 → 0.28.0
- hono 4.12.5 → 4.12.10, @hono/node-server 1.19.11 → 1.19.12
- vitest 4.0.18 → 4.1.2, eslint 10.0.2 → 10.2.0
- @rcrsr/rill pinned to ^0.18.4, @rcrsr/rill-config to ^0.18.4
- Node minimum raised to >=22.0.0; CI matrix tests Node 22, 24, 25
- Compatibility workflow installs latest compatible @rcrsr/rill instead of @latest

### Added

- `@rcrsr/rill-agent` core package with router, manifest loading, HTTP harness, and type definitions
- `pnpm.onlyBuiltDependencies` for esbuild in root package.json
- `@rcrsr/rill-agent-foundry` package for Azure AI Foundry Responses API protocol support with session management and SSE streaming
- `context` parameter to `AgentRouter.run()` for session variable forwarding across requests
- `onChunk` callback in `RunContext` for incremental stream chunk delivery from handler to harness
- `streamed` flag in `RunResponse` to signal handler used chunk streaming instead of flat result

### Fixed

- Foundry harness streams rill stream closures incrementally instead of collecting chunks into an array before emitting SSE deltas

### Removed

- `@rcrsr/rill-agent-build`, `@rcrsr/rill-agent-bundle`, `@rcrsr/rill-agent-harness`, `@rcrsr/rill-agent-proxy`, `@rcrsr/rill-agent-run` (consolidated into `@rcrsr/rill-agent`)
- Demo apps: content-pipeline, data-cruncher, feedback-analyzer, tool-calling

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
