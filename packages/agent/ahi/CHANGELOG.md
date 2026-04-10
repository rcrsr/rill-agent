# Changelog

All notable changes to `@rcrsr/rill-agent-ext-ahi` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.5] - 2026-04-09

### Added

- Inlined `ExtensionResult`, `InputSchema`, and `InProcessRunner` types previously imported from `@rcrsr/rill-agent-shared`

### Changed

- `@rcrsr/rill` peer dependency pinned to `~0.18.4`
- No longer imports from `@rcrsr/rill-agent-shared` or `@rcrsr/rill-agent-registry`

### Removed

- AHI registry-mode resolution (`agents: string[]` with a `registry` URL); use static URL mode only
