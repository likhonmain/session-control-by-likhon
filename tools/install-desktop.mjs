import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Use Desktop's own immutable generation installer. Installing the bare npm
// name selects an unrelated public package that happens to have the same name.
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(process.env.APPDATA, 'dsh-desktop', 'harness');
const modules = path.join(process.env.LOCALAPPDATA, 'Programs', 'DSH Desktop',
  'resources', 'app.asar.unpacked', 'node_modules');
const { createGenerationPackageBackend } = await import(pathToFileURL(path.join(
  modules, 'dsh-desktop-market-installer', 'generations', 'package-backend.mjs')));
const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
const backup = path.join(source, 'backups', `startup-${Date.now()}`);
await fs.mkdir(backup, { recursive: true });
for (const [relative, target] of [
  ['profiles/web/package.json', 'profile-package.json'],
  ['profiles/.generations/desired.json', 'desired.json'],
  ['profiles/web/cordis.patch.yml', 'profile-cordis.patch.yml']
]) {
  await fs.copyFile(path.join(home, relative), path.join(backup, target));
}
// Preserve the replaced generation even if Desktop later sweeps it.
try {
  await fs.cp(path.join(home, 'profiles/web/node_modules/dsh-session-control'),
    path.join(backup, 'previous-installed-plugin'), { recursive: true, dereference: true });
} catch {}

// Stage only shipping files and dependencies; exclude backups and test tools.
const stagingSource = path.join(backup, 'local-source');
await fs.mkdir(stagingSource);
for (const file of ['package.json', 'package-lock.json', ...manifest.files]) {
  await fs.cp(path.join(source, file), path.join(stagingSource, file), { recursive: true });
}
await fs.cp(path.join(source, 'node_modules'), path.join(stagingSource, 'node_modules'),
  { recursive: true, dereference: true });
const backend = createGenerationPackageBackend({
  dshHome: home,
  dshEntryPath: path.join(modules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  nodeExecutablePath: path.join(modules, 'node', 'bin', 'node.exe'),
  pnpmEntryPath: path.join(modules, 'pnpm', 'bin', 'pnpm.cjs'),
  environment: { ...process.env, DSH_HOME: home }
});
const result = await backend.install({
  kind: 'path', path: stagingSource, spec: `file:${stagingSource}`,
  expectedName: manifest.name, expectedVersion: manifest.version,
  autoInstallPeers: false, minimumReleaseAge: 0,
  onOutput: text => process.stdout.write(text)
});
if (result.packageResult?.exitCode !== 0) {
  throw new Error(`Local installation failed: ${result.packageResult?.output ?? 'no result'}`);
}
result.commit();
console.log(`Installed ${manifest.name}@${manifest.version} from the workspace.`);
console.log(`Rollback backup: ${backup}`);
