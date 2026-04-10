# How to deploy a rill agent to Azure AI Foundry

This guide walks through packaging a rill agent as a Foundry hosted agent. The example is a minimal `hello-agent` that takes a user message and returns a chat response from an LLM. See [agent-foundry.md](agent-foundry.md) for the harness reference.

## Prerequisites

- Node.js 22+
- Docker
- Azure CLI (`az`) with access to a Container Registry
- Python 3.10+ for the deploy script
- An Azure AI Foundry project endpoint

## 1. Prepare the rill script and rill-config.json

Build a normal rill project. The agent takes a `message` parameter and returns the LLM's reply.

**main.rill**

```rill
^("Reply to a user message")(message: string) || {
  use<ext:ai> => $ai

  $ai.message($message)() => $reply
  $reply
}:string => $chat
```

**rill-config.json**

```json
{
  "name": "hello-agent",
  "version": "0.1.0",
  "main": "main.rill:chat",
  "extensions": {
    "mounts": {
      "ai": "@rcrsr/rill-ext-openai"
    },
    "config": {
      "ai": {
        "api_key": "${GROQ_API_KEY}",
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "base_url": "https://api.groq.com/openai/v1"
      }
    }
  }
}
```

The `name` and `version` fields drive Foundry agent registration in step 7.

## 2. Run rill-build to produce a build directory

Install the rill CLI if you have not already:

```bash
npm install --save-dev @rcrsr/rill-cli
```

Run the build directly:

```bash
npx rill-build . --output build
```

`rill-build` writes a runnable manifest layout under `build/<agent-name>/`:

```
build/
  hello-agent/
    handler.js       # AgentHandler implementation
    main.rill
    rill-config.json
    runtime.js
```

`@rcrsr/rill-agent`'s `loadManifest('./build')` auto-detects this single-agent layout.

## 3. Create the foundry.js entry file

The container runs this file as PID 1. It loads the manifest, builds a router, and starts the Foundry harness.

**foundry.js**

```javascript
import { createRouter, loadManifest } from '@rcrsr/rill-agent';
import { createFoundryHarness } from '@rcrsr/rill-agent-foundry';

const router = await createRouter(await loadManifest('./build'), {
  globalVars: process.env,
});

const harness = createFoundryHarness(router);
await harness.listen();

const port = process.env.PORT ?? '8088';
console.log(`Foundry agent running on http://0.0.0.0:${port}`);
```

`globalVars: process.env` forwards every environment variable to the rill runtime, so `${GROQ_API_KEY}` placeholders in `rill-config.json` resolve at startup. `loadManifest('./build')` reads `build/hello-agent/rill-config.json` directly, and `createFoundryHarness` defaults `agentName` to `router.defaultAgent()` so the entry file does not need to import any config.

Create a slim `package.docker.json` that pins the agent packages to local copies inside the image:

**package.docker.json**

```json
{
  "name": "hello-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@rcrsr/rill-agent": "file:./packages/agent/core",
    "@rcrsr/rill-agent-foundry": "file:./packages/agent/foundry"
  }
}
```

The Dockerfile renames this to `package.json` inside the image so `npm install` resolves the workspace packages from local file paths instead of npm.

## 4. Create the Dockerfile

```dockerfile
FROM node:22-slim
WORKDIR /app

# Copy the prebuilt agent core and foundry packages from the workspace.
COPY packages/agent/core/dist/ ./packages/agent/core/dist/
COPY packages/agent/core/package.json ./packages/agent/core/
COPY packages/agent/foundry/dist/ ./packages/agent/foundry/dist/
COPY packages/agent/foundry/package.json ./packages/agent/foundry/

# Rewrite workspace: protocol refs that npm cannot resolve.
RUN sed -i 's/"workspace:\^"/"*"/g' ./packages/agent/foundry/package.json

# Copy the rill-build output and the foundry entry point.
COPY demo/hello-agent/build/ ./build/
COPY demo/hello-agent/foundry.js ./
COPY demo/hello-agent/package.docker.json ./package.json

RUN npm install --omit=dev

EXPOSE 8088
CMD ["node", "foundry.js"]
```

Two details matter:

1. Copies are written relative to the **monorepo root**, not the agent directory. Build the image from the repo root so `packages/agent/core/dist/` and `demo/hello-agent/build/` both resolve.
2. The `sed` step rewrites `"workspace:^"` peer ranges in `foundry/package.json` to `"*"`. npm cannot interpret the workspace protocol once the file leaves the monorepo.

## 5. Build the container

From the monorepo root:

```bash
docker build \
  -f demo/hello-agent/Dockerfile \
  -t hello-agent:latest \
  .
```

Smoke-test locally before pushing:

```bash
docker run --rm -p 8088:8088 \
  -e GROQ_API_KEY=$GROQ_API_KEY \
  hello-agent:latest

curl http://localhost:8088/liveness
```

`/liveness` returns 200 immediately, `/readiness` returns 200 once `init()` completes.

## 6. Push to Azure Container Registry

```bash
az login
az acr login --name rilltestcr

docker tag hello-agent:latest \
  rilltestcr.azurecr.io/hello-agent:latest

docker push rilltestcr.azurecr.io/hello-agent:latest
```

Replace `rilltestcr` with your registry name. The Foundry project must have AcrPull access to this registry.

## 7. Register the agent with Foundry

Foundry agents are registered via the `azure-ai-projects` Python SDK. The script reads `rill-config.json` to keep the agent name and version in sync with the rill project.

**deploy.py**

```python
"""Register a rill agent as a Foundry hosted agent.

Prerequisites:
  pip install "azure-ai-projects>=2.0.0" azure-identity
  az login
  az acr login --name rilltestcr

Usage:
  python deploy.py
"""

import json
import os

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    AgentProtocol,
    HostedAgentDefinition,
    ProtocolVersionRecord,
)
from azure.identity import DefaultAzureCredential

with open("rill-config.json") as f:
    config = json.load(f)

AGENT_NAME = config["name"]
AGENT_VERSION = config["version"]
IMAGE = os.environ.get(
    "AGENT_IMAGE",
    "rilltestcr.azurecr.io/hello-agent:latest",
)
PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]

client = AIProjectClient(
    endpoint=PROJECT_ENDPOINT,
    credential=DefaultAzureCredential(),
    allow_preview=True,
)

agent = client.agents.create_version(
    agent_name=AGENT_NAME,
    definition=HostedAgentDefinition(
        container_protocol_versions=[
            ProtocolVersionRecord(
                protocol=AgentProtocol.RESPONSES, version="v1"
            )
        ],
        cpu="1",
        memory="2Gi",
        image=IMAGE,
        environment_variables={
            "AZURE_AI_PROJECT_ENDPOINT": PROJECT_ENDPOINT,
            "GROQ_API_KEY": os.environ.get("GROQ_API_KEY", ""),
        },
    ),
)

print(f"Created: {agent.name} v{agent.version}")
```

Run it:

```bash
export AZURE_AI_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
export GROQ_API_KEY=...
python deploy.py
```

Foundry pulls the image from ACR, starts the container, and waits for `/readiness` to return 200 before routing traffic to `POST /responses`.

## Iterating

The fast inner loop after the first deploy:

```bash
npx rill-build . --output build                                         # rebuild rill output
docker build -f demo/hello-agent/Dockerfile -t hello-agent:latest .
docker tag hello-agent:latest rilltestcr.azurecr.io/hello-agent:latest
docker push rilltestcr.azurecr.io/hello-agent:latest
python deploy.py                                                        # bump version in rill-config.json first
```

Bump `rill-config.json#version` before each `deploy.py` run. `create_version` rejects duplicates.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `npm install` fails with `EUNSUPPORTEDPROTOCOL` | `workspace:^` left in `foundry/package.json` | Confirm the `sed` step ran in the Dockerfile |
| `/readiness` stays 503 | `init()` threw inside a handler | Check container logs; verify `globalVars` includes every `${VAR}` referenced in `rill-config.json` |
| `401 Unauthorized` from ACR | `az acr login` not run, or Foundry has no AcrPull role | Re-run `az acr login` and grant the project's managed identity AcrPull |
| `create_version` rejects with conflict | Version already registered | Bump `version` in `rill-config.json` |
