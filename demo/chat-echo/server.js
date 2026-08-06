import { createRouter, loadManifest } from '@rcrsr/rill-agent';
import { createChatHarness } from '@rcrsr/rill-agent-chat';

const buildDir = new URL('./build/', import.meta.url).pathname;
const manifest = await loadManifest(buildDir);
const router = await createRouter(manifest);
const harness = createChatHarness(router);

const port = Number(process.env.PORT ?? 3000);
await harness.listen(port);

console.log(`chat-echo listening on http://localhost:${port}`);
console.log('Try:');
console.log(`  curl -N -X POST http://localhost:${port}/v1/chat/completions \\`);
console.log(`    -H 'Content-Type: application/json' \\`);
console.log(`    -d '{"model":"chat-echo","messages":[{"role":"user","content":"hello"}]}'`);
