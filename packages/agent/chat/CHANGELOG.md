# Changelog

All notable changes to `@rcrsr/rill-agent-chat` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Dependencies:** Bump hono to ^4.13.5 and @hono/node-server to ^2.1.1. ([#63](https://github.com/rcrsr/rill-agent/pull/63))

### Fixed

- **Chunk guarding and disconnect handling:** handler chunks are guarded against malformed data; buffered streaming aborts on disconnect; ineligible agents return 4xx instead of 404. ([#62](https://github.com/rcrsr/rill-agent/pull/62))

## [0.20.0] - 2026-08-06

### Added

- Initial release: OpenAI-compatible chat completions harness (`createChatHarness`) with SSE streaming, per-agent and default-agent routes, discovery, and metrics
- Chat eligibility via `describe()` signature inspection (`inspectChatHandler`): requires a required `messages` param typed `list(dict(role: string, content: string))` and a `stream(<chunk>)` return type
- Default-export `RillHarness` adapter for rill 0.20 bundle mode: `serve` assembles a router from the bundle's compiled packages and hosts it over the chat harness on `config.port` (default 3000); `postBuild` asserts each package emitted `handler.js`
- `rill.role: "harness"` package.json declaration for the rill 0.20 `rill install` gate
