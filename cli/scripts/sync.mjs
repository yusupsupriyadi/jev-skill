// Copies the plugin's skills and CLI into bundle/, the only copy a published package carries.
// Runs before every publish, so the tarball can never ship skills older than the plugin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(cliRoot, '..');
const bundle = path.join(cliRoot, 'bundle');

const version = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8')).version;
const pluginVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
if (version !== pluginVersion) {
  throw new Error(`cli/package.json is ${version} but the plugin is ${pluginVersion}. Bump them together.`);
}

fs.rmSync(bundle, { recursive: true, force: true });
fs.mkdirSync(bundle, { recursive: true });
fs.cpSync(path.join(repoRoot, 'skills'), path.join(bundle, 'skills'), { recursive: true });
fs.cpSync(path.join(repoRoot, 'scripts'), path.join(bundle, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(cliRoot, 'LICENSE'));
console.log(`Synced skills/ and scripts/ from the plugin into cli/bundle/ (${version}).`);
