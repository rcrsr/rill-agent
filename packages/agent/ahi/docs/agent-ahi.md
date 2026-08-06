# Agent AHI

*Agent-to-agent HTTP invocation for rill scripts*

This extension lets a rill agent call other agents by name. It mounts a dict of `<agentName>` callables into the runtime. A script hoists the mount with `use<ext:ahi> => $ahi` and calls `$ahi.summarizer(params)`, receiving the remote agent's result as a dict. The host handles endpoint resolution, timeout enforcement, and error mapping.

Static URL mode hardcodes endpoints at deploy time. When agents are co-located in the same harness process, `createInProcessFunction` replaces HTTP calls with direct in-process invocation.

## Quick Start

```typescript
import { createAhiExtension } from '@rcrsr/rill-agent-ext-ahi';

const ext = createAhiExtension({
  agents: {
    summarizer: { url: 'http://localhost:3001' },
    classifier: { url: 'http://localhost:3002' },
  },
  timeout: 10000,
});
```

```rill
use<ext:ahi> => $ahi
$ahi.summarizer([text: "Long article content..."]) => $result
$result -> log
```

## Configuration

### Static URL Mode

Provide a dict of agent names to endpoint URLs:

```typescript
const ext = createAhiExtension({
  agents: {
    summarizer: { url: 'http://localhost:3001' },
    classifier: { url: 'http://localhost:3002' },
  },
  timeout: 30000,
});
```

URLs support `${VAR_NAME}` environment variable substitution at init time.

### Config Fields

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agents` | `Record<string, {url}>` | — | Agent name to endpoint config map (required) |
| `timeout` | number | `30000` | Request timeout in ms |

### Manifest Usage

Mount AHI in `rill-config.json` and give it an `agents` map. The mount name
(`ahi` below) becomes the `use<ext:...>` path:

```json
{
  "extensions": {
    "mounts": { "ahi": "@rcrsr/rill-agent-ext-ahi" },
    "config": {
      "ahi": {
        "agents": { "summarizer": { "url": "http://localhost:3001" } },
        "timeout": 30000
      }
    }
  }
}
```

`rill run` then builds and serves the project through its declared harness. See
the `demo/ahi-caller` example for the full two-agent setup.

## Functions

Each configured agent name is a member of the mounted `ahi` dict. Hoist the mount
once, then call by member access. All agents share the same signature and return
shape.

**$ahi.\<name\>(params)** — invoke a remote agent:

```rill
use<ext:ahi> => $ahi
$ahi.classifier([text: "hello world", lang: "en"]) => $result
$result -> log
```

The function sends an HTTP POST to the target agent's `/run` endpoint with the provided params. It returns the agent's result value directly.

### Request Payload

Each call sends:

```json
{
  "params": { "text": "hello world" },
  "trigger": {
    "type": "agent",
    "agentName": "caller-agent",
    "sessionId": "sess_abc123"
  },
  "timeout": 30000
}
```

The caller's agent name and session ID propagate automatically for tracing. The `X-Correlation-ID` header forwards the root correlation ID.

### Timeout Propagation

When the caller has a deadline set in metadata, AHI forwards the smaller of the remaining time or the configured timeout. This prevents downstream agents from outliving their caller.

## In-Process Mode

When agents share a harness process, `createInProcessFunction` builds a callable that replaces the HTTP hop with a direct in-process call. Scripts use the same `$ahi.<name>` syntax with no code changes. In-process mode eliminates HTTP overhead and serialization.

```typescript
import { createInProcessFunction } from '@rcrsr/rill-agent-ext-ahi';

const fn = createInProcessFunction(runner, 'summarizer', 30000);
```

## Error Behavior

**Factory errors** (synchronous, at extension creation):

- Unresolved `${VAR}` in a static URL — throws `Error`

**Runtime errors** (during agent invocation, all `RuntimeError`):

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `RILL-R027` | Target agent rejected params (validation failed) |
| 404 | `RILL-R028` | Target agent unreachable |
| 429 | `RILL-R032` | Target agent rate limited |
| 500 | `RILL-R029` | Target agent execution failed |

**Network errors:**

| Condition | Error Code | Description |
|-----------|------------|-------------|
| Timeout | `RILL-R030` | Request exceeded timeout |
| Connection refused | `RILL-R031` | Target endpoint unreachable |
| Post-dispose call | `RILL-R033` | Extension already disposed |

**In-process errors:**

| Condition | Error Code | Description |
|-----------|------------|-------------|
| Capacity exceeded | `RILL-R032` | Target agent at session limit |
| Execution failed | `RILL-R029` | Target agent returned failed state |

## Dispose

Call `dispose()` to cancel in-flight requests and block further calls:

```typescript
await ext.dispose?.();
```

After dispose, any `$ahi.<name>` call throws `RILL-R033` immediately.

## See Also

- [`@rcrsr/rill-agent-http`](../../http/README.md) — the HTTP harness that serves an AHI caller
- [`demo/ahi-caller`](../../../../demo/ahi-caller) — a runnable two-agent example
