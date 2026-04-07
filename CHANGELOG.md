# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
