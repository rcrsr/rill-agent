# Tool Calling Demo

A single-agent demo that uses `llm::tool_loop()` to let an LLM pick and invoke tools in a loop until it answers the user's question. Demonstrates the rill tool definition pattern and multi-turn LLM interaction.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm run -r build
```

Set your Groq API key:

```bash
export GROQ_API_KEY="gsk_..."
```

## Build and start

```bash
cd demo/tool-calling
pnpm build   # rill-agent-bundle build agent.json
pnpm start   # rill-agent-run with example question
```

Or run directly:

```bash
rill-agent-run dist/ tool-calling-demo --config config.json \
  --param question="What is the weather in Paris and Tokyo? Convert the Paris temperature to Fahrenheit."
```

Example output:

```json
{
  "answer": "Paris: 22°C (71.6°F), partly cloudy. Tokyo: 28°C, humid and sunny.",
  "turns": 3,
  "usage": { "input_tokens": 1520, "output_tokens": 380 }
}
```

## Tools

Three simulated tools are defined inline in `scripts/main.rill`:

| Tool | Description |
|------|-------------|
| `weather` | Returns hardcoded weather for 5 cities (paris, london, tokyo, new_york, sydney) |
| `convert_temperature` | Converts between Celsius and Fahrenheit |
| `calculator` | Basic arithmetic: add, subtract, multiply, divide |

The LLM decides which tools to call and in what order. `llm::tool_loop()` runs up to 5 turns, invoking the selected tools each turn until the LLM produces a final answer.

## Runtime configuration

`config.json` provides the `llm` extension its API credentials:

```json
{
  "llm": {
    "api_key": "${GROQ_API_KEY}",
    "model": "llama-3.3-70b-versatile",
    "base_url": "https://api.groq.com/openai/v1"
  }
}
```

## What it demonstrates

- **Tool loop**: `llm::tool_loop()` with max_turns for multi-step reasoning
- **Inline tool definitions**: Tools defined in rill using caret (`^`) annotations
- **LLM decision-making**: The model selects tools based on the question
- **Structured output**: Result includes answer, turn count, and token usage

## Build output

```
dist/
  bundle.json
  handlers.js
  agents/
    tool-calling-demo/
      scripts/main.rill
  .well-known/agent-card.json
```
