// Disposable real-Harness fixture for checking native rich clipboard output.
// It uses a local fake model and never opens a user's existing sessions.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHome, launch } from './host.mjs';

let count = 0;
const server = http.createServer(async (req, res) => {
  for await (const _chunk of req) { /* consume the local model request */ }
  const title = ++count === 1 ? 'FIRST output isolation check' : 'Word Copy Sample';
  const content = `# ${title}\n\nThis is **bold**, *italic*, and [a link](https://example.com).\n\n1. First item\n2. Second item\n\nInline math: $x^2 + y^2 = z^2$.\n\n$$H(s) = \\frac{\\omega_0^2}{s^2 + 2\\zeta\\omega_0 s + \\omega_0^2}$$\n\n| Name | Value |\n| --- | --- |\n| Result | **42** |\n\nFinal paragraph of ${title}.`;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({
    id: 'word-copy-' + count, object: 'chat.completion.chunk', created: 1700000000,
    model: 'sc-test', choices: [{ index: 0, delta, finish_reason }]
  }) + '\n\n');
  event({ role: 'assistant', reasoning_content: 'PRIVATE REASONING SHOULD NOT BE COPIED' });
  event({ content }); event({}, 'stop'); res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { home, directory } = await createHome(server.address().port);
const host = await launch(home, directory, 43311);
try {
  const sessionId = (await host.api('/api/sc-test/create', {})).value.sessionId;
  for (const text of ['FIRST user input must not be copied', 'SECOND user input must not be copied']) {
    await host.api('/api/sc-test/prompt', { sessionId, text });
  }
  const preview = { directory, sessionId, baseURL: host.baseURL, endpoint: host.endpoint };
  await fs.writeFile(path.join(directory, 'preview.json'), JSON.stringify(preview, null, 2));
  console.log(JSON.stringify(preview));
} catch (error) {
  await host.stop(); server.close(); throw error;
}
async function stop() { await host.stop(); server.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
