import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLATFORMS, detectHost, detectPlatforms, getPlatform, skillRoots } from '../scripts/lib/platforms.mjs';
import { discoverCatalog } from '../scripts/lib/catalog.mjs';

function makeHome(dirs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-home-'));
  for (const dir of dirs) fs.mkdirSync(path.join(home, dir), { recursive: true });
  return home;
}

function writeSkill(root, name, description) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), '---\ndescription: ' + description + '\n---\nbody\n');
}

test('every platform declares a project and a global skills path', () => {
  assert.ok(PLATFORMS.length >= 9);
  for (const platform of PLATFORMS) {
    assert.ok(platform.id && platform.label);
    assert.match(platform.project, /skills$/);
    assert.match(platform.global, /skills$/);
    assert.equal(getPlatform(platform.id), platform);
  }
  assert.equal(getPlatform('nope'), null);
});

test('the host is Claude Code when Claude Code set the environment', () => {
  assert.equal(detectHost({ CLAUDE_PLUGIN_ROOT: '/x' }), 'claude');
  assert.equal(detectHost({ CLAUDE_CONFIG_DIR: '/x' }), 'claude');
  assert.equal(detectHost({ CLAUDE_PROJECT_DIR: '/x' }), 'claude');
});

test('the host is unknown rather than guessed', () => {
  assert.equal(detectHost({}), null);
  assert.equal(detectHost({ TERM_PROGRAM: 'something-else' }), null);
});

test('JEV_PLATFORM names the host, and a bad value is ignored', () => {
  assert.equal(detectHost({ JEV_PLATFORM: 'codex' }), 'codex');
  assert.equal(detectHost({ JEV_PLATFORM: 'codex', CLAUDE_PLUGIN_ROOT: '/x' }), 'codex');
  assert.equal(detectHost({ JEV_PLATFORM: 'not-an-agent' }), null);
});

test('only existing directories are returned', () => {
  const home = makeHome(['.claude/skills', '.gemini/skills']);
  const roots = skillRoots({ cwd: path.join(home, 'nowhere'), homeDir: home });
  const dirs = roots.map((r) => path.basename(path.dirname(r.dir)));
  assert.deepEqual(dirs.sort(), ['.claude', '.gemini']);
});

test('agents that share a directory are reported once, together', () => {
  const home = makeHome(['.agents/skills']);
  const roots = skillRoots({ cwd: path.join(home, 'nowhere'), homeDir: home });
  assert.equal(roots.length, 1, 'one directory, not one per agent');
  assert.ok(roots[0].platforms.includes('Codex'));
  assert.ok(roots[0].platforms.includes('Kimi Code'));
});

test('naming a host narrows the scan to that agent', () => {
  const home = makeHome(['.claude/skills', '.agents/skills', '.cursor/skills']);
  const all = skillRoots({ cwd: path.join(home, 'nowhere'), homeDir: home });
  const claudeOnly = skillRoots({ cwd: path.join(home, 'nowhere'), homeDir: home, platformId: 'claude' });
  assert.equal(all.length, 3);
  assert.equal(claudeOnly.length, 1);
  assert.match(claudeOnly[0].dir, /\.claude/);
});

test('project directories are found alongside global ones', () => {
  const home = makeHome(['.claude/skills']);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-proj-'));
  fs.mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
  const scopes = skillRoots({ cwd, homeDir: home, platformId: 'claude' }).map((r) => r.scope).sort();
  assert.deepEqual(scopes, ['global', 'project']);
});

test('detectPlatforms lists the agents present on the machine', () => {
  const home = makeHome(['.claude/skills', '.hermes/skills']);
  const labels = detectPlatforms({ cwd: path.join(home, 'nowhere'), homeDir: home });
  assert.ok(labels.includes('Claude Code'));
  assert.ok(labels.includes('Hermes'));
  assert.equal(labels.includes('Cursor'), false);
});

test('a host never sees another agent skills it could not invoke', () => {
  const home = makeHome([]);
  writeSkill(path.join(home, '.claude', 'skills'), 'claude-only', 'A Claude Code skill');
  writeSkill(path.join(home, '.agents', 'skills'), 'codex-only', 'A Codex skill');
  const configDir = path.join(home, '.claude');
  const cwd = path.join(home, 'project');
  fs.mkdirSync(cwd, { recursive: true });

  const asClaude = discoverCatalog({ configDir, cwd, homeDir: home, platform: 'claude' }).map((e) => e.id);
  assert.deepEqual(asClaude, ['claude-only']);

  const asCodex = discoverCatalog({ configDir, cwd, homeDir: home, platform: 'codex' }).map((e) => e.id);
  assert.deepEqual(asCodex, ['codex-only']);

  const unknown = discoverCatalog({ configDir, cwd, homeDir: home, platform: null }).map((e) => e.id).sort();
  assert.deepEqual(unknown, ['claude-only', 'codex-only']);
});
