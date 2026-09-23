import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLATFORMS } from '../scripts/lib/platforms.mjs';
import {
  AGENTS,
  VERSION,
  claudePluginCommands,
  detectAgents,
  detectConflicts,
  installRuntime,
  installSkills,
  installedVersion,
  listSkills,
  resolveTargets,
  rewriteSkill,
  runtimeDirFor,
} from '../cli/lib/install.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SKILLS_DIR = path.join(REPO, 'skills');
const RUNTIME_DIR = path.join(REPO, 'scripts');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('the installer targets exactly the skills directories jev scans', () => {
  const strip = ({ id, label, project, global }) => ({ id, label, project, global });
  assert.deepEqual(AGENTS.map(strip), PLATFORMS.map(strip));
});

test('the installer version matches the plugin it installs', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(VERSION, plugin.version);
});

test('every skill is installed under the name its frontmatter declares', () => {
  const names = listSkills(SKILLS_DIR).map((s) => s.name).sort();
  assert.deepEqual(names, ['jev-ask', 'jev-doctor', 'jev-judge', 'jev-route', 'jev-setup']);
});

test('an installed skill calls the CLI by absolute path and drops the JEV_HOME footer', () => {
  const source = fs.readFileSync(path.join(SKILLS_DIR, 'doctor', 'SKILL.md'), 'utf8');
  const out = rewriteSkill(source, { runtimeDir: 'C:\\Users\\me\\.jev', version: '9.9.9' });
  assert.doesNotMatch(out, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.doesNotMatch(out, /JEV_HOME/);
  assert.match(out, /allowed-tools: Bash\(node "C:\/Users\/me\/\.jev\/scripts\/cli\.mjs" \*\)/);
  assert.match(out, /^!`node "C:\/Users\/me\/\.jev\/scripts\/cli\.mjs" doctor \|\| true`$/m);
  assert.match(out, /npx jev-ai.*9\.9\.9/);
  assert.equal((out.match(/^## /gm) || []).length, (source.match(/^## /gm) || []).length, 'one footer replaced by one');
});

test('agents that share a folder share one target', () => {
  const cwd = tempDir('jev-inst-cwd-');
  const targets = resolveTargets({ location: 'project', agents: ['antigravity', 'kimi', 'copilot', 'claude'], home: cwd, cwd });
  assert.equal(targets.length, 2);
  const shared = targets.find((t) => t.path.endsWith(path.join('.agents', 'skills')));
  assert.deepEqual(shared.agents.map((a) => a.id).sort(), ['antigravity', 'copilot', 'kimi']);
});

test('a global install uses each agent\'s own global folder', () => {
  const home = tempDir('jev-inst-home-');
  const [codex] = resolveTargets({ location: 'global', agents: ['codex'], home, cwd: home });
  assert.equal(codex.path, path.join(home, '.agents', 'skills'));
});

test('agents are pre-selected when their folder already exists', () => {
  const cwd = tempDir('jev-inst-detect-');
  fs.mkdirSync(path.join(cwd, '.cursor'));
  assert.deepEqual(detectAgents({ location: 'project', home: cwd, cwd }), ['cursor']);
});

test('an install writes a runnable CLI and skills that point at it', () => {
  const home = tempDir('jev-inst-e2e-');
  const runtimeDir = runtimeDirFor(home);
  installRuntime({ source: RUNTIME_DIR, runtimeDir, version: '1.2.3' });
  const targets = resolveTargets({ location: 'project', agents: ['codex'], home, cwd: home });
  const written = installSkills({ skillsDir: SKILLS_DIR, targets, runtimeDir, version: '1.2.3' });

  assert.equal(written.length, 5);
  const skill = fs.readFileSync(path.join(home, '.codex', 'skills', 'jev-doctor', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(runtimeDir.split(path.sep).join('/') + '/scripts/cli.mjs'));
  assert.equal(installedVersion(targets[0].path), '1.2.3');
  assert.equal(fs.readFileSync(path.join(runtimeDir, 'VERSION'), 'utf8').trim(), '1.2.3');

  // The copied CLI runs on its own, away from the repository it came from.
  const status = spawnSync(process.execPath, [path.join(runtimeDir, 'scripts', 'cli.mjs'), 'setup', '--status'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, OPENROUTER_API_KEY: '', TYPESAFE_API_KEY: '' },
  });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^provider: /m);
});

test('existing skill folders are kept unless the user asks to overwrite', () => {
  const home = tempDir('jev-inst-keep-');
  const runtimeDir = runtimeDirFor(home);
  const targets = resolveTargets({ location: 'project', agents: ['cursor'], home, cwd: home });
  installSkills({ skillsDir: SKILLS_DIR, targets, runtimeDir, version: '1.0.0' });

  const names = listSkills(SKILLS_DIR).map((s) => s.name);
  assert.equal(detectConflicts({ targets, names }).length, 5);
  assert.equal(installSkills({ skillsDir: SKILLS_DIR, targets, runtimeDir, version: '2.0.0' }).length, 0);
  assert.equal(installedVersion(targets[0].path), '1.0.0');
  assert.equal(installSkills({ skillsDir: SKILLS_DIR, targets, runtimeDir, version: '2.0.0', overwrite: true }).length, 5);
  assert.equal(installedVersion(targets[0].path), '2.0.0');
});

test('the Claude Code plugin route installs at the scope the user picked', () => {
  const [add, install] = claudePluginCommands('project');
  assert.deepEqual(add, ['plugin', 'marketplace', 'add', 'yusupsupriyadi/jev-skill', '--scope', 'project']);
  assert.deepEqual(install, ['plugin', 'install', 'jev@jev-skill', '--scope', 'project']);
  assert.equal(claudePluginCommands('global')[1].at(-1), 'user');
});
