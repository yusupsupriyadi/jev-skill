import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverCatalog, readEnabledPlugins, resolveInstallPath } from '../scripts/lib/catalog.mjs';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function skill(description, extra = '') {
  return '---\ndescription: ' + description + '\n' + extra + '---\nbody\n';
}

/** Builds a throwaway ~/.claude plus a project dir that mirrors the real layouts. */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-catalog-'));
  const configDir = path.join(root, '.claude');
  const cwd = path.join(root, 'project');
  const cache = path.join(configDir, 'plugins', 'cache');
  fs.mkdirSync(cwd, { recursive: true });

  const alpha = path.join(cache, 'alpha');
  write(path.join(alpha, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'alpha' }));
  write(path.join(alpha, 'skills', 'build', 'SKILL.md'), skill('Builds the app'));
  write(path.join(alpha, 'skills', 'hidden', 'SKILL.md'), skill('Never routed', 'disable-model-invocation: true\n'));
  write(path.join(alpha, 'commands', 'ship.md'), skill('Ships a release'));
  write(path.join(alpha, 'agents', 'reviewer.md'), '---\nname: alpha-reviewer\ndescription: Reviews code\n---\n');

  const beta = path.join(cache, 'beta');
  write(path.join(beta, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'beta' }));
  write(path.join(beta, 'skills', 'deploy', 'SKILL.md'), skill('Deploys the app'));

  const off = path.join(cache, 'off');
  write(path.join(off, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'off' }));
  write(path.join(off, 'skills', 'never', 'SKILL.md'), skill('Disabled plugin'));

  write(path.join(configDir, 'settings.json'), JSON.stringify({
    enabledPlugins: { 'alpha@mp': true, 'off@mp': false },
  }));
  write(path.join(configDir, 'settings.local.json'), JSON.stringify({
    enabledPlugins: { 'beta@mp': true },
  }));
  write(path.join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'alpha@mp': [{ scope: 'user', installPath: alpha }],
      // beta exists only at project scope, like a real project-only install
      'beta@mp': [{ scope: 'project', projectPath: cwd, installPath: beta }],
      'off@mp': [{ scope: 'user', installPath: off }],
    },
  }));

  write(path.join(configDir, 'skills', 'mine', 'SKILL.md'), skill('A personal skill'));
  write(path.join(configDir, 'skills', 'synced', 'aaa_bbb', 'docs', 'SKILL.md'), skill('A synced skill'));
  write(path.join(configDir, 'skills', 'kit', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'kit' }));
  write(path.join(configDir, 'skills', 'kit', 'skills', 'tool', 'SKILL.md'), skill('A skills-dir plugin skill'));

  write(path.join(cwd, '.claude', 'skills', 'local-thing', 'SKILL.md'), skill('A project skill'));

  return { root, configDir, cwd };
}

test('discovery covers plugins, personal, synced, skills-dir and project scopes', () => {
  const { configDir, cwd } = makeFixture();
  const ids = discoverCatalog({ configDir, cwd }).map((e) => e.id).sort();

  assert.ok(ids.includes('alpha:build'), 'plugin skill');
  assert.ok(ids.includes('alpha:ship'), 'plugin command');
  assert.ok(ids.includes('alpha:alpha-reviewer'), 'agent named from frontmatter');
  assert.ok(ids.includes('beta:deploy'), 'project-scope-only plugin');
  assert.ok(ids.includes('mine'), 'personal skill');
  assert.ok(ids.includes('anthropic-skills:docs'), 'synced skill');
  assert.ok(ids.includes('kit:tool'), 'skills-directory plugin');
  assert.ok(ids.includes('local-thing'), 'project skill');

  assert.equal(ids.includes('alpha:hidden'), false, 'disable-model-invocation is excluded');
  assert.equal(ids.includes('off:never'), false, 'disabled plugin is excluded');
});

test('routeExclude drops a namespace', () => {
  const { configDir, cwd } = makeFixture();
  const ids = discoverCatalog({ configDir, cwd, routeExclude: ['alpha:'] }).map((e) => e.id);
  assert.equal(ids.some((id) => id.startsWith('alpha:')), false);
  assert.ok(ids.includes('beta:deploy'));
});

test('includeAgents false removes agents', () => {
  const { configDir, cwd } = makeFixture();
  const kinds = new Set(discoverCatalog({ configDir, cwd, includeAgents: false }).map((e) => e.kind));
  assert.equal(kinds.has('agent'), false);
});

test('enabledPlugins merges user and local settings', () => {
  const { configDir, cwd } = makeFixture();
  const enabled = readEnabledPlugins({ configDir, cwd }).sort();
  assert.deepEqual(enabled, ['alpha@mp', 'beta@mp']);
});

test('install path prefers a project entry whose projectPath contains the cwd', () => {
  const entries = [
    { scope: 'user', installPath: '/user/path' },
    { scope: 'project', projectPath: '/repo', installPath: '/project/path' },
  ];
  assert.equal(resolveInstallPath(entries, path.join('/repo', 'sub')), '/project/path');
  assert.equal(resolveInstallPath(entries, '/elsewhere'), '/user/path');
  assert.equal(resolveInstallPath([{ scope: 'project', projectPath: '/repo', installPath: '/only' }], '/other'), '/only');
  assert.equal(resolveInstallPath([], '/x'), null);
});
