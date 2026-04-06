import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeHarness,
  createAgentHost,
  type LogLevel,
} from '@rcrsr/rill-agent-harness';

const __dirname = dirname(fileURLToPath(import.meta.url));

const harness = await composeHarness(__dirname, {
  config: {},
  env: process.env,
});

const port = 4002;
const logLevel = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
const host = createAgentHost(harness.agents, { port, logLevel });

harness.bindHost(host);

await host.listen(port);
console.log(`Content pipeline running on http://localhost:${port}`);
console.log('Agents: orchestrator, classifier, summarizer');
console.log(`  POST http://localhost:${port}/orchestrator/run`);
console.log(`  POST http://localhost:${port}/classifier/run`);
console.log(`  POST http://localhost:${port}/summarizer/run`);
