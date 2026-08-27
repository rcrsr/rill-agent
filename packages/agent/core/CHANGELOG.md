# Changelog

All notable changes to `@rcrsr/rill-agent` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Core validation and error classification:** Fixed boolean validation, agent-not-found error classification, router cleanup on failure, and manifest validation for empty agents maps. ([#62](https://github.com/rcrsr/rill-agent/pull/62))

## [0.20.0] - 2026-08-06

### Added

- `assembleManifest(entries, defaultAgent?)` builds an `AgentManifest` from explicit `{ name, dir }` entries, importing `handler.js` from each compiled directory — used by rill 0.20 bundle-harness adapters that receive per-mount compiled output paths
- `AgentRouter.manifest` is now part of the public interface
- `HandlerDescription.returnType` optional field carries the handler closure's `:T` annotation (emitted by rill-build ≥ 0.19.6)

## [0.19.0] - 2026-05-02

### Changed

- Version bumped to align with framework-wide 0.19.0 release (no source changes)

## [0.18.6] - 2026-04-10

### Added

- `routerErrorToStatus(err)` exported from package root, returns `404 | 500`
- `validateParams(params, schema)` exported from package root

### Changed

- HTTP harness extracted into separate package `@rcrsr/rill-agent-http`; core no longer ships HTTP transport code

### Removed

- `hono` and `@hono/node-server` runtime dependencies (core is now transport-agnostic)
- `/http` subpath export

## [0.18.5] - 2026-04-09

### Added

- Initial release of the consolidated core package combining router, manifest loading, and HTTP harness
- `context` parameter on `AgentRouter.run()` for session variable forwarding across requests
- `onChunk` callback in `RunContext` for incremental stream chunk delivery from handler to harness
- `streamed` flag in `RunResponse` to signal handler used chunk streaming instead of flat result
- `/http` subpath export for the Hono HTTP harness

### Changed

- Consolidated `@rcrsr/rill-agent-build`, `@rcrsr/rill-agent-bundle`, `@rcrsr/rill-agent-harness`, `@rcrsr/rill-agent-proxy`, and `@rcrsr/rill-agent-run` into this package
- TypeScript 5.9.3 to 6.0.2
- hono 4.12.5 to 4.12.10, @hono/node-server 1.19.11 to 1.19.12
- Node minimum raised to >=22.0.0
