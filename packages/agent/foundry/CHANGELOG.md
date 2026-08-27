# Changelog

All notable changes to `@rcrsr/rill-agent-foundry` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Dependencies:** Bump hono to ^4.13.5 and @hono/node-server to ^2.1.1. ([#63](https://github.com/rcrsr/rill-agent/pull/63))

### Fixed

- **Session and error handling:** Fixed session slot leakage with malformed response IDs and properly enforced maxConcurrentSessions limits. Malformed input now returns 400 instead of 500, streaming emits correct error codes, and SSE emission is guarded on stream cancellation. ([#62](https://github.com/rcrsr/rill-agent/pull/62))

## [0.20.0] - 2026-08-06

### Added

- Default-export `RillHarness` adapter for rill 0.20 bundle mode: `serve` assembles a router from the bundle's compiled packages and hosts it over the Foundry Responses harness on `config.port` (default 3000); `postBuild` asserts each package emitted `handler.js`
- `rill.role: "harness"` package.json declaration for the rill 0.20 `rill install` gate

## [0.19.0] - 2026-05-02

### Changed

- `@rcrsr/rill-agent` dependency bumped to `~0.19.0`
- `@hono/node-server` bumped from `^1.19.12` to `^2.0.1`; `hono` to `^4.12.16`
- `@opentelemetry/sdk-node` bumped to `^0.216.0`, `@opentelemetry/exporter-trace-otlp-http` to `^0.216.0`, `@opentelemetry/resources` to `^2.7.1`
- Telemetry initialization migrated from `new Resource(...)` to `resourceFromAttributes(...)` for the OpenTelemetry 2.x resources API

## [0.18.6] - 2026-04-10

### Changed

- Harness lifecycle helpers now sourced from shared `@rcrsr/rill-agent-hono-kit` package
- `@rcrsr/rill-agent` dependency bumped to `~0.18.6`

## [0.18.5] - 2026-04-09

### Added

- Initial release of the Foundry harness for the Azure AI Foundry Responses API
- Session management and SSE streaming over the Responses protocol
- Azure Conversations client and OpenTelemetry integration

### Fixed

- Harness streams rill stream closures incrementally instead of collecting chunks into an array before emitting SSE deltas

### Changed

- `@rcrsr/rill-agent` peer dependency pinned to `~0.18.5`
