# Getting Started

Build and run your first rill agent in 4 steps.

## Prerequisites

- Node.js 20+
- pnpm 9+
- A [rill](https://github.com/rcrsr/rill) runtime understanding (see rill docs for the language itself)

## 1. Scaffold a New Agent

```bash
npx @rcrsr/rill-agent-bundle init my-agent --extensions anthropic
cd my-agent
pnpm install
```

This creates:

```
my-agent/
  agent.json       # Agent manifest
  main.rill        # Entry script
  package.json     # Node project with rill dependencies
  .env.example     # Required environment variables
```

The `--extensions` flag pre-configures the Anthropic LLM extension. Other options: `openai`, `kv`, `fetch`, `fs`, `qdrant`.

## 2. Define the Agent Manifest

`agent.json` declares the agent's identity, extensions, and I/O contract.

```json
{
  "name": "my-agent",
  "version": "0.1.0",
  "runtime": "@rcrsr/rill@^0.9.0",
  "entry": "main.rill",
  "extensions": {
    "llm": {
      "package": "@rcrsr/rill-ext-anthropic"
    }
  },
  "input": {
    "question": {
      "type": "string",
      "required": true,
      "description": "The question to answer"
    }
  },
  "output": {
    "type": "dict",
    "fields": {
      "answer": { "type": "string" }
    }
  }
}
```

See [concepts.md](concepts.md) for the full manifest format.

## 3. Write the Entry Script

`main.rill` is a rill script that receives input parameters and returns a result.

```rill
$question => llm::message("Answer this question concisely: " + $question) => $answer
[answer: $answer]
```

The `$question` variable comes from the `input` declaration in the manifest. `llm::message()` calls the configured LLM extension. The final expression is the agent's return value.

## 4. Build and Run

Build the agent into a deployable bundle:

```bash
npx @rcrsr/rill-agent-bundle build agent.json --output dist/
```

Run it with parameters and extension config:

```bash
npx @rcrsr/rill-agent-run dist/ my-agent \
  --param question="What is the capital of France?" \
  --config '{"llm":{"api_key":"'"$ANTHROPIC_API_KEY"'"}}'
```

The result prints to stdout as JSON:

```json
{"answer": "The capital of France is Paris."}
```

## Running as an HTTP Server

Generate an HTTP harness entry point, then start the server:

```bash
npx @rcrsr/rill-agent-build --harness http dist/
node dist/harness.js
```

The server listens on port 3000. Send requests to it:

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{"params": {"question": "What is the capital of France?"}}'
```

The server provides session management, SSE streaming, health checks, and Prometheus metrics out of the box.

## Config Files

Store extension config in a JSON file instead of inline:

```json
{
  "llm": {
    "api_key": "${ANTHROPIC_API_KEY}",
    "model": "claude-sonnet-4-20250514"
  }
}
```

`${VAR}` tokens resolve from environment variables at runtime.

```bash
export ANTHROPIC_API_KEY="sk-..."
npx @rcrsr/rill-agent-run dist/ my-agent --config config.json --param question="Hello"
```

## Next Steps

- [Concepts](concepts.md) — Manifests, composition, extensions, sessions, and AHI
- [Architecture](architecture.md) — Package map and data flow
- [Deployment](deployment.md) — HTTP, stdio, serverless, and Docker patterns
- [CLI Reference](cli-reference.md) — All CLI commands and flags
- [Demo apps](../demo/) — Working examples in the `demo/` directory
