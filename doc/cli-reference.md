# CLI Reference

All command-line tools in the rill agent framework.

## rill-agent-bundle

Build agent bundles from manifests.

### build

```bash
rill-agent-bundle build <manifest-path> [--output <dir>]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `manifest-path` | — | Path to `agent.json` or `harness.json` |
| `--output` | `dist/` | Output directory for the bundle |

Validates the manifest, resolves extensions, compiles custom functions, and writes a self-contained bundle directory.

### init

```bash
rill-agent-bundle init <project-name> [--extensions <ext1,ext2>]
```

| Argument | Description |
|----------|-------------|
| `project-name` | Valid npm package name |
| `--extensions` | Comma-separated: `anthropic`, `openai`, `qdrant`, `fetch`, `kv`, `fs` |

Creates a new project directory with `agent.json`, `main.rill`, `package.json`, and `.env.example`.

### check

```bash
rill-agent-bundle check --platform <name> [<bundle-path>]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `--platform` | — | Target platform to validate against |
| `bundle-path` | `.` | Bundle directory path |

Validates bundle compatibility with the target platform. Exit code 0 on success, 1 on failure.

---

## rill-agent-build

Generate harness entry points for agent bundles.

```bash
rill-agent-build --harness <type> [--output <path>] <bundle-dir>
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--harness` | Yes | — | `http`, `stdio`, `gateway`, or `worker` |
| `--output` | No | `<bundle-dir>/harness.js` | Output file path |
| `bundle-dir` | Yes | — | Path to bundle directory |

Reads `bundle.json` and `handlers.js` from the bundle directory. Writes a typed ESM module for the target transport.

---

## rill-agent-run

Execute bundled agents from the command line.

```bash
rill-agent-run <bundle-dir> [agent-name] [options]
```

| Argument | Description |
|----------|-------------|
| `bundle-dir` | Path to bundle directory |
| `agent-name` | Agent to execute within the bundle |

### Options

| Option | Description |
|--------|-------------|
| `--param key=value` | Named input parameter (repeatable) |
| `--timeout <ms>` | Execution timeout in milliseconds |
| `--config <file-or-json>` | Config JSON file path or inline JSON string |
| `--log-level <level>` | `silent`, `info`, or `debug` (default: `info`, reads `LOG_LEVEL` env) |

### Input Sources

Parameters come from `--param` flags or piped JSON on stdin. When both provide the same key, `--param` takes precedence.

```bash
# Flags
rill-agent-run dist/ my-agent --param text="hello" --param lang=en

# Piped JSON
echo '{"text":"hello","lang":"en"}' | rill-agent-run dist/ my-agent

# Both (--param wins on conflict)
echo '{"lang":"fr"}' | rill-agent-run dist/ my-agent --param lang=en
```

### Output

- stdout: Result value as JSON
- stderr: Logs, extension events, diagnostics

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Failure (runtime error, timeout, invalid input) |

### Config Interpolation

`${VAR}` patterns in config values resolve from `process.env`. Unset variables remain as-is.

```bash
rill-agent-run dist/ my-agent --config '{"llm":{"api_key":"${ANTHROPIC_API_KEY}"}}'
```

---

## rill-agent-proxy

Multi-agent routing proxy with child process management.

```bash
rill-agent-proxy --bundles <dir> [options]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--bundles` | Yes | — | Path to bundles directory |
| `--port` | No | `3000` | HTTP listen port |
| `--config` | No | — | Proxy config JSON file path |
| `--max-concurrent` | No | `10` | Global concurrency limit |
| `--max-per-agent` | No | `5` | Per-agent concurrency limit |
| `--timeout` | No | `60000` | Default request timeout in ms |
| `--log-level` | No | `info` | `debug`, `info`, `warn`, or `error` |

CLI flags override values from the config file.

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/agents/:name/run` | Execute an agent |
| `GET` | `/agents/:name/card` | Agent discovery card |
| `GET` | `/catalog` | All catalog entries |
| `POST` | `/catalog/refresh` | Re-scan bundles directory |
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/readyz` | Readiness probe |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/status` | Active processes and concurrency |

### Bundle Directory Layout

```
bundles/
├── agent-a/
│   ├── bundle.json
│   └── harness.js
└── agent-b/
    ├── bundle.json
    └── harness.js
```

Directories missing `bundle.json` or `harness.js` are skipped with a warning.

## See Also

- [Getting Started](getting-started.md) — First agent walkthrough
- [Concepts](concepts.md) — Manifests, extensions, sessions
- [Deployment](deployment.md) — Transport modes and patterns
- Package-level API docs: [bundle](../packages/agent/bundle/docs/agent-bundle.md), [harness](../packages/agent/harness/docs/agent-harness.md), [build](../packages/agent/build/docs/agent-build.md), [run](../packages/agent/run/docs/agent-run.md), [proxy](../packages/agent/proxy/docs/agent-proxy.md)
