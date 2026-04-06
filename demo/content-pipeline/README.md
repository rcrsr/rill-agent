# Content Pipeline Demo

A multi-agent harness that orchestrates text classification and summarization. The orchestrator agent calls classifier and summarizer agents via AHI (Agent-to-Agent Invocation), then merges results.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm run -r build
```

Set your Groq API key:

```bash
export OPENAI_API_KEY="gsk_..."
```

## Build and start

```bash
cd demo/content-pipeline
pnpm build   # builds all 3 agent bundles
pnpm start   # tsx host.ts
```

The harness listens on port 4002 with 3 agents mounted under `/:agentName/run`.

Send a request to the orchestrator:

```bash
curl -X POST http://localhost:4002/orchestrator/run \
  -H "Content-Type: application/json" \
  -d '{"params": {"text": "Quantum computing researchers achieved a breakthrough in error correction, reducing qubit error rates by 90%."}}'
```

## Agents

| Agent | Entry Script | Role |
|-------|-------------|------|
| classifier | `scripts/classify.rill` | Extracts category, language, and confidence |
| summarizer | `scripts/summarize.rill` | Produces summary, key points, and word count |
| orchestrator | `scripts/orchestrate.rill` | Calls classifier and summarizer via AHI |

The orchestrator uses `ahi::classifier()` and `ahi::summarizer()` to invoke co-located agents. Because all 3 agents share the same harness process, AHI uses in-process invocation (no HTTP).

Each agent has its own `rill-config.json` in its subdirectory under `agents/`.

## Configuration

Extension config is embedded in each agent's `rill-config.json` under `extensions.config`:

```json
{
  "extensions": {
    "mounts": {
      "llm": { "package": "@rcrsr/rill-ext-openai" }
    },
    "config": {
      "llm": {
        "api_key": "${OPENAI_API_KEY}",
        "model": "openai/gpt-oss-20b",
        "base_url": "https://api.groq.com/openai/v1"
      }
    }
  }
}
```

## What it demonstrates

- **Multi-agent harness**: 3 agents in one process
- **AHI invocation**: Orchestrator calls other agents via `ahi::` functions
- **In-process optimization**: Co-located agents skip HTTP serialization
- **Structured LLM output**: `llm::generate()` with typed schema extraction
- **Per-agent configuration**: Each agent has its own `rill-config.json`

## Build output

```
dist/
  bundle.json
  handlers.js
  agents/
    classifier/scripts/classify.rill
    summarizer/scripts/summarize.rill
    orchestrator/scripts/orchestrate.rill
  .well-known/
    classifier/agent-card.json
    summarizer/agent-card.json
    orchestrator/agent-card.json
```
