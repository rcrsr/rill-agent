# Changelog

All notable changes to `@rcrsr/rill-agent-http` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.6] - 2026-04-10

### Added

- Initial release of the Hono HTTP harness extracted from `@rcrsr/rill-agent`
- `httpHarness(router)` factory and `HttpHarness` type
- Routes: `GET /agents`, `POST /agents/:name/run`, `POST /run`
- `hono` and `@hono/node-server` are carried as runtime dependencies of this package
