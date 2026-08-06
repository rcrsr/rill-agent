import { createRouter, loadManifest } from '@rcrsr/rill-agent';
import { httpHarness } from '@rcrsr/rill-agent-http';

const buildDir = new URL('./build/http-echo/', import.meta.url).pathname;
const manifest = await loadManifest(buildDir);
const router = await createRouter(manifest);
const harness = httpHarness(router);

const port = Number(process.env.PORT ?? 3001);
await harness.listen(port);

console.log(`http-echo listening on http://localhost:${port}`);
console.log('Try:');
console.log(`  curl http://localhost:${port}/agents`);
console.log(`  curl -X POST http://localhost:${port}/run \\`);
console.log(`    -H 'Content-Type: application/json' \\`);
console.log(`    -d '{"params":{"input":"hello"}}'`);
