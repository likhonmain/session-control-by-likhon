import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

const modules = path.join(process.env.LOCALAPPDATA, 'Programs', 'DSH Desktop',
  'resources', 'app.asar.unpacked', 'node_modules');
const home = path.join(process.env.APPDATA, 'dsh-desktop', 'harness');
const node = path.join(modules, 'node', 'bin', 'node.exe');
const entry = path.join(modules, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const resources = path.resolve(modules, '../..');
const child = spawn(node, [entry, '--profile', 'web',
  '--patch', path.join(home, 'desktop-host-sources.patch.yml'),
  '--patch', path.join(resources, 'dsh-desktop-market.patch.yml'),
  '--port', '43299', '--no-open'], {
  cwd: path.join(process.env.APPDATA, 'dsh-desktop', 'launch-root'),
  env: { ...process.env, DSH_HOME: home }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
let launchError;
child.on('error', error => { launchError = error; });
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const deadline = Date.now() + 30000;
  let endpoint;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error('Startup process exited before becoming ready.');
    const match = output.match(/dsh web: (http:\/\/[^\s]+)/);
    if (match) { endpoint = new URL(match[1]); break; }
    await delay(200);
  }
  if (!endpoint) throw new Error('Harness did not announce readiness within 30 seconds.');
  const exchange = await fetch(endpoint, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (exchange.status !== 303) throw new Error('Browser authentication exchange failed.');
  const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Browser authentication cookie missing.');
  const get = async pathname => {
    const url = new URL(pathname, endpoint);
    const response = await fetch(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${pathname}`);
    return response;
  };
  const status = await (await get('/api/session-control/status')).json();
  if (status.version !== '1.0.2-local.1' || status.build !== 'local-conversation-controls') {
    throw new Error('The intended local build was not loaded.');
  }
  const html = await (await get('/')).text();
  if (!html.includes('dsh-session-control')) throw new Error('Client module is absent from the page module graph.');
  await delay(1000);
  if (/duplicate exact route|duplicate prefix route|error (?:dsh-session-control|session-control):/.test(output)) {
    throw new Error('Plugin registration error during startup.');
  }
  const pkg = JSON.parse(await fs.readFile(path.join(home,
    'profiles/web/node_modules/dsh-session-control/package.json'), 'utf8'));
  console.log(JSON.stringify({
    startup: 'passed', backend: status, clientModuleInPage: true,
    installedClientExport: pkg.exports['./client'], historyActionsTested: false
  }, null, 2));
} catch (error) {
  // Startup output contains authentication URLs. Redact before reporting.
  console.error(output.replace(/([?&]token=)[^\s"'&]+/g, '$1[redacted]').slice(-12000));
  throw error;
} finally {
  child.kill('SIGTERM');
  await delay(250);
}
