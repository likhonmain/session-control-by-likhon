import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { modules } from './harness.mjs';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function createHome(apiPort) {
  const directory = path.join(root, 'tests', '.runs', 'run-' + Date.now());
  const home = path.join(directory, 'home'), profile = path.join(home, 'profiles', 'web');
  await fs.mkdir(path.join(profile, 'node_modules'), { recursive: true });
  await fs.symlink(path.join(modules, '@deepseek-ai'), path.join(profile, 'node_modules', '@deepseek-ai'), 'junction');
  await fs.symlink(root, path.join(profile, 'node_modules', 'dsh-session-control'), 'junction');
  await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'disposable-sc-test', private: true,
    dependencies: { 'dsh-session-control': '2.0.0-local.1' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-session-control'] } } }));
  const driver = pathToFileURL(path.join(root, 'tests/driver/index.js')).href;
  await fs.writeFile(path.join(profile, 'cordis.patch.yml'), `
- id: llm-pi-ai
  config:
    providers:
      sc-test:
        displayName: Disposable local test
        apiKeyEnv: SC_TEST_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${apiPort}/v1
        models:
          - id: sc-test
            name: Local test
            contextWindow: 200000
            maxTokens: 4096
            input: [text]
- id: agent-default-model
  config:
    provider: sc-test
    model: sc-test
- id: session-title-llm
  disabled: true
- id: session-title-first-prompt-llm
  disabled: true
- insert:
    - id: sc-test-driver
      name: '${driver}'
`);
  return { directory, home };
}
export async function launch(home, directory, port = 43301) {
  const node = path.join(modules, 'node/bin/node.exe');
  const entry = path.join(modules, '@deepseek-ai/dsh/lib/bin.js');
  const child = spawn(node, [entry, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: directory, env: { ...process.env, DSH_HOME: home, SC_TEST_CWD: directory, SC_TEST_API_KEY: 'disposable-local-test' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '', launchError;
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', error => { launchError = error; });
  const stop = async () => {
    if (child.exitCode !== null) return;
    const done = new Promise(resolve => child.once('exit', resolve)); child.kill();
    await Promise.race([done, delay(2000)]);
  };
  const logs = () => output.replace(/([?&]token=)[^\s"'&]+/g, '$1[redacted]');
  try {
    const deadline = Date.now() + 30000;
    let endpoint;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error('Isolated host exited before startup.');
      const match = output.match(/dsh web: (http:\/\/[^\s]+)/);
      if (match) { endpoint = new URL(match[1]); break; }
      await delay(100);
    }
    if (!endpoint) throw new Error('Isolated host startup timed out.');
    const exchange = await fetch(endpoint, { redirect: 'manual' });
    const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Missing test authentication cookie.');
    const baseURL = endpoint.origin;
    const api = async (url, data) => {
      const result = await fetch(new URL(url, baseURL), { method: data === undefined ? 'GET' : 'POST',
        headers: { Cookie: cookie, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
        body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000) });
      const body = await result.json();
      if (!result.ok || body.ok === false) throw new Error(`${url}: ${body.error || result.status}`);
      return body;
    };
    return { stop, api, logs, baseURL, endpoint: endpoint.href };
  } catch (error) { await stop(); console.error(logs().slice(-8000)); throw error; }
}
