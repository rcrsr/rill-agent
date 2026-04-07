import { createRouter, loadManifest } from '@rcrsr/rill-agent';
import { httpHarness } from '@rcrsr/rill-agent/http';

const router = await createRouter(await loadManifest('./bundle'), {
  globalVars: process.env,
});
const harness = httpHarness(router);
await harness.listen(3000);
console.log('Agent server running on http://localhost:3000');
console.log('Routes:');
console.log('  GET  /agents');
console.log('  POST /run');
console.log('  POST /agents/:name/run');
