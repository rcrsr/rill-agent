# @rcrsr/rill-agent-shared

Shared types, validation, and card generation for the [rill](https://github.com/rcrsr/rill) agent framework. Provides `SlimHarnessConfig`, `AgentCard`, manifest validation via zod, and `@{VAR}` interpolation utilities.

## Install

```bash
npm install @rcrsr/rill-agent-shared
```

## Quick Start

```typescript
import {
  generateAgentCard,
  validateSlimHarnessConfig,
  interpolateConfigDeep,
} from '@rcrsr/rill-agent-shared';

const card = generateAgentCard({
  name: 'classifier',
  version: '1.0.0',
  description: 'Routes feedback by category',
  inputs: { text: { type: 'string', required: true } },
  output: { type: 'dict' },
});

const result = validateSlimHarnessConfig(rawConfig);
if (!result.ok) console.error(result.issues);
```

## Documentation

See [full documentation](docs/agent-shared.md) for types, validation rules, card generation, and interpolation.

## License

MIT
