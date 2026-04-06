# Getting Started

Build and run your first rill agent in 4 steps.

## Prerequisites

- Node.js 22+
- pnpm 10+
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
  rill-config.json   # Agent configuration
  main.rill          # Entry script
  package.json       # Node project with rill dependencies
  .env.example       # Required environment variables
```

The `--extensions` flag pre-configures the Anthropic LLM extension. Other options: `openai`, `kv`, `fetch`, `fs`, `qdrant`.

## 2. Define the Agent Configuration

`rill-config.json` declares the agent's identity, extensions, and entry point.

```json
{
  "name": "my-agent",
  "version": "0.1.0",
  "main": "main.rill:handler",
  "runtime": ">=0.18.0",
  "extensions": {
    "mounts": {
      "llm": { "package": "@rcrsr/rill-ext-anthropic" }
    },
    "config": {
      "llm": {
        "api_key": "${ANTHROPIC_API_KEY}",
        "model": "claude-sonnet-4-20250514"
      }
    }
  }
}
```

See [concepts.md](concepts.md) for the full configuration format.

## 3. Write the Entry Script

`main.rill` is a rill script that receives input parameters and returns a result.

```rill
$question => llm::message("Answer this question concisely: " + $question) => $answer
[answer: $answer]
```

The `$question` variable comes from the handler's parameters. `llm::message()` calls the configured LLM extension. The final expression is the agent's return value.

## 4. Build and Run

Build the agent into a deployable bundle:

```bash
npx @rcrsr/rill-agent-bundle build
```

Run it with parameters:

```bash
npx @rcrsr/rill-agent-run dist/ my-agent \
  --param question="What is the capital of France?"
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

## Next Steps

- [Concepts](concepts.md) -- Configuration format, composition, extensions, sessions, and AHI
- [Architecture](architecture.md) -- Package map and data flow
- [Deployment](deployment.md) -- HTTP, stdio, serverless, and Docker patterns
- [CLI Reference](cli-reference.md) -- All CLI commands and flags
- [Demo apps](../demo/) -- Working examples in the `demo/` directory
