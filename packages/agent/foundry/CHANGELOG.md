# Changelog

All notable changes to `@rcrsr/rill-agent-foundry` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
