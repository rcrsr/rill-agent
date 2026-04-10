# Changelog

All notable changes to `@rcrsr/rill-agent` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
