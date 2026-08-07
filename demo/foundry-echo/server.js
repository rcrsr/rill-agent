import { createRouter, loadManifest } from '@rcrsr/rill-agent';
import { createFoundryHarness } from '@rcrsr/rill-agent-foundry';

const buildDir = new URL('./build/foundry-echo/', import.meta.url).pathname;
const manifest = await loadManifest(buildDir);
const router = await createRouter(manifest);

const port = Number(process.env.PORT ?? 3002);
const harness = createFoundryHarness(router, { port });
await harness.listen();

console.log(`foundry-echo listening on http://localhost:${port}`);
console.log('Try:');
console.log(`  curl -X POST http://localhost:${port}/responses \\`);
console.log(`    -H 'Content-Type: application/json' \\`);
console.log(`    -d '{"input":"hello"}'`);
