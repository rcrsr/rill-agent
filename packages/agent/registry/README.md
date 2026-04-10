# @rcrsr/rill-agent-registry

Service registry client for the [rill](https://github.com/rcrsr/rill) agent framework. Publishes and resolves agent endpoints over HTTP. Agents self-register on startup, send periodic heartbeats, and resolve other agents by name.

## Install

```bash
npm install @rcrsr/rill-agent-registry
```

## Quick Start

```typescript
import { createRegistryClient } from '@rcrsr/rill-agent-registry';

const client = createRegistryClient({ url: 'http://localhost:4000' });

await client.register({
  name: 'classifier',
  version: '1.0.0',
  endpoint: 'http://localhost:3001',
  card: agentCard,
  dependencies: [],
});

const agent = await client.resolve('summarizer');
console.log(agent.endpoint);
```

## Documentation

See [full documentation](docs/agent-registry.md) for client API, registration flow, heartbeats, and error handling.

## License

MIT
