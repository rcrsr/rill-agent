# @rcrsr/rill-agent

Core agent runtime for the [rill](https://github.com/rcrsr/rill) language. Loads agent manifests, builds an `AgentRouter`, and serves agents over HTTP via the included Hono harness. Supports single-agent and multi-agent deployments.

## Install

```bash
npm install @rcrsr/rill-agent
```

For the HTTP harness, install the separate package:

```bash
npm install @rcrsr/rill-agent-http
```

## Quick Start

```typescript
import { loadManifest, createRouter } from '@rcrsr/rill-agent';
import { httpHarness } from '@rcrsr/rill-agent-http';

const manifest = await loadManifest('./build');
const router = await createRouter(manifest, {
  globalVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
});

const harness = httpHarness(router);
await harness.listen(3000);
```

A handler module exports four functions: `describe`, `init`, `execute`, `dispose`. Place a `handler.js` in a directory for single-agent mode, or a `manifest.json` listing multiple agents for multi-agent mode.

## Documentation

See [full documentation](docs/agent-core.md) for handler contract, router behavior, manifest format, and HTTP routes.

## License

MIT
