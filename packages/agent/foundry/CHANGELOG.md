# Changelog

All notable changes to `@rcrsr/rill-agent-foundry` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.5] - 2026-04-09

### Added

- Initial release of the Foundry harness for the Azure AI Foundry Responses API
- Session management and SSE streaming over the Responses protocol
- Azure Conversations client and OpenTelemetry integration

### Fixed

- Harness streams rill stream closures incrementally instead of collecting chunks into an array before emitting SSE deltas

### Changed

- `@rcrsr/rill-agent` peer dependency pinned to `~0.18.5`
