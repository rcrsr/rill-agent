# @rcrsr/rill-agent-ext-ahi

[rill](https://github.com/rcrsr/rill) extension for the Agent Host Interface (AHI). Registers `ahi::<agentName>` host functions so a rill agent can call other agents over HTTP. Uses static URL resolution with `${VAR_NAME}` environment variable substitution.

## Install

```bash
npm install @rcrsr/rill-agent-ext-ahi
```

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
ahi::summarizer([text: "Long article content..."]) => $result
$result -> log
```

## Documentation

See [full documentation](docs/agent-ahi.md) for configuration, error mapping, and in-process binding.

## License

MIT
