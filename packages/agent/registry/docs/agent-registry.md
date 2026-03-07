# Agent Registry

*Service registry client for agent discovery and registration*

`@rcrsr/rill-agent-registry` provides an HTTP client for publishing and resolving agent endpoints. Agents self-register on startup, send periodic heartbeats, and resolve other agents by name. The AHI extension uses this client in registry mode to discover agent endpoints at runtime instead of hardcoding URLs.

The client uses native `fetch` and requires no external dependencies beyond `@rcrsr/rill-agent-shared` for type definitions.

## Quick Start

```typescript
import { createRegistryClient } from '@rcrsr/rill-agent-registry';

const client = createRegistryClient({
  url: 'http://localhost:4000',
});

// Register an agent
await client.register({
  name: 'classifier',
  version: '1.0.0',
  endpoint: 'http://localhost:3001',
  card: agentCard,
  dependencies: [],
});

// Resolve another agent
const agent = await client.resolve('summarizer');
console.log(agent.endpoint); // http://localhost:3002
```

## Configuration

```typescript
const client = createRegistryClient({
  url: 'http://localhost:4000',
  auth: 'my-bearer-token',
});
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | Registry base URL (required) |
| `auth` | string | — | Bearer token for Authorization header |

The factory throws synchronously on missing URL, empty URL, or non-http/https protocols. Trailing slashes on the URL are stripped automatically.

## Client Methods

**register(payload)** — Register an agent with the registry:

```typescript
await client.register({
  name: 'classifier',
  version: '1.0.0',
  endpoint: 'http://localhost:3001',
  card: agentCard,
  dependencies: ['summarizer'],
});
```

Throws on HTTP 409 (agent name already registered by another endpoint).

**deregister(name)** — Remove an agent from the registry:

```typescript
await client.deregister('classifier');
```

Treats HTTP 404 as success (agent already gone).

**heartbeat(name)** — Send a liveness heartbeat:

```typescript
await client.heartbeat('classifier');
```

Errors are logged to console but never thrown. This prevents heartbeat failures from crashing the agent process.

**resolve(name)** — Look up an agent by name:

```typescript
const agent = await client.resolve('summarizer');
console.log(agent.endpoint); // http://localhost:3002
console.log(agent.status);   // 'active'
```

Throws when the agent is not found (HTTP 404).

**list()** — List all registered agents:

```typescript
const agents = await client.list();
for (const agent of agents) {
  console.log(`${agent.name} @ ${agent.endpoint} [${agent.status}]`);
}
```

**dispose()** — Release resources and stop heartbeats:

```typescript
await client.dispose();
```

After dispose, `heartbeat()` becomes a no-op. Call before process exit.

## Types

### RegistrationPayload

```typescript
interface RegistrationPayload {
  readonly name: string;
  readonly version: string;
  readonly endpoint: string;
  readonly card: AgentCard;
  readonly dependencies: string[];
}
```

### ResolvedAgent

```typescript
interface ResolvedAgent {
  readonly name: string;
  readonly version: string;
  readonly endpoint: string;
  readonly input?: InputSchema;
  readonly output?: OutputSchema;
  readonly status: 'active' | 'stale' | 'draining';
  readonly lastHeartbeat: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Registered agent name |
| `version` | string | Agent semver version |
| `endpoint` | string | Base URL for the agent |
| `input` | InputSchema | Agent input contract (when available) |
| `output` | OutputSchema | Agent output contract (when available) |
| `status` | string | `'active'`, `'stale'`, or `'draining'` |
| `lastHeartbeat` | string | ISO 8601 timestamp of last heartbeat |

## Error Behavior

**Factory errors** (synchronous, before any HTTP call):

- Missing URL — throws `Error`
- Empty URL — throws `Error`
- Non-http/https protocol — throws `Error`

**Runtime errors** (from HTTP calls):

- Register conflict (409) — throws `Error`
- Resolve not found (404) — throws `Error`
- Network failure — throws `TypeError`
- Non-2xx response — throws `Error` with status code

**Non-throwing operations:**

- `heartbeat()` logs errors but never throws
- `deregister()` treats 404 as success

## See Also

- [Agent AHI](agent-ahi.md) — Agent-to-agent invocation extension (uses registry client)
- [Agent Harness](agent-harness.md) — Production HTTP server with self-registration support
- [Agent Shared](agent-shared.md) — AgentCard, InputSchema, and OutputSchema type definitions
