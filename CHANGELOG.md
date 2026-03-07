# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
