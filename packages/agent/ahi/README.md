# @rcrsr/rill-agent-ext-ahi

[rill](https://github.com/rcrsr/rill) extension for the Agent Host Interface (AHI). Mounts a dict of `<agentName>` callables so a rill agent can call other agents over HTTP. Uses static URL resolution with `${VAR_NAME}` environment variable substitution.

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

Mount the extension in `rill-config.json` under `extensions.mounts` (with its
`agents` map under `extensions.config`), then hoist the mount with
`use<ext:...>` and call an agent by member access:

```rill
use<ext:ahi> => $ahi
$ahi.summarizer([text: "Long article content..."]) => $result
$result -> log
```

`ahi` is the mount name; `summarizer` is a configured agent. Calling the mount
name directly without the `use<ext:ahi> => $ahi` hoist raises
`RILL_R006 Unknown function`.

## Documentation

See [full documentation](docs/agent-ahi.md) for configuration, error mapping, and in-process binding.

## License

MIT
