import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

export const MARKETPLACE = 'yusupsupriyadi/jev-skill';
export const PLUGIN = 'jev@jev-skill';

const PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const FOOTER_HEADING = '## Running the CLI on another agent';

/**
 * Where each agent reads skills. It must stay identical to PLATFORMS in the plugin's
 * scripts/lib/platforms.mjs, which decides what jev can route to; a test holds them together.
 */
export const AGENTS = [
  { id: 'claude', label: 'Claude Code', project: '.claude/skills', global: '.claude/skills' },
  { id: 'codex', label: 'Codex', project: '.codex/skills', global: '.agents/skills' },
  { id: 'cursor', label: 'Cursor', project: '.cursor/skills', global: '.cursor/skills' },
  { id: 'gemini', label: 'Gemini CLI', project: '.gemini/skills', global: '.gemini/skills' },
  { id: 'antigravity', label: 'Antigravity', project: '.agents/skills', global: '.gemini/config/skills' },
  { id: 'opencode', label: 'OpenCode', project: '.opencode/skills', global: '.config/opencode/skills' },
  { id: 'kimi', label: 'Kimi Code', project: '.agents/skills', global: '.agents/skills' },
  { id: 'hermes', label: 'Hermes', project: '.hermes/skills', global: '.hermes/skills' },
  { id: 'copilot', label: 'GitHub Copilot', project: '.agents/skills', global: '.github/skills' },
];

/**
 * The skills and the CLI they call. A published package carries them in bundle/; a run
 * from a clone of the repository reads them from the repository itself.
 */
export function findSources(root = PACKAGE_ROOT) {
  for (const base of [path.join(root, 'bundle'), path.join(root, '..')]) {
    const skills = path.join(base, 'skills');
    const runtime = path.join(base, 'scripts');
    if (fs.existsSync(path.join(runtime, 'cli.mjs')) && fs.existsSync(skills)) return { skills, runtime };
  }
  return null;
}

/** Skill folders keyed by the name in their frontmatter, which is the folder name agents expect. */
export function listSkills(skillsDir) {
  const skills = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const name = /^name:\s*(\S+)\s*$/m.exec(fs.readFileSync(file, 'utf8'));
    if (name) skills.push({ source: entry.name, name: name[1] });
  }
  return skills;
}

/** One CLI for every agent and project, so an update replaces a single copy. */
export function runtimeDirFor(home = os.homedir()) {
  return path.join(home, '.jev');
}

function baseFor(location, { home, cwd }) {
  return location === 'global' ? home : cwd;
}

/** Agents that read the same folder share one target, so each folder is written once. */
export function resolveTargets({ location, agents, home = os.homedir(), cwd = process.cwd() }) {
  const byPath = new Map();
  for (const agent of AGENTS.filter((a) => agents.includes(a.id))) {
    const target = path.join(baseFor(location, { home, cwd }), location === 'global' ? agent.global : agent.project);
    const found = byPath.get(target);
    if (found) found.agents.push(agent);
    else byPath.set(target, { path: target, agents: [agent] });
  }
  return [...byPath.values()];
}

/** Agents whose config folder already exists here, to pre-select them. */
export function detectAgents({ location, home = os.homedir(), cwd = process.cwd() }) {
  const base = baseFor(location, { home, cwd });
  return AGENTS
    .filter((a) => fs.existsSync(path.join(base, path.dirname(location === 'global' ? a.global : a.project))))
    .map((a) => a.id);
}

export function detectConflicts({ targets, names }) {
  const conflicts = [];
  for (const target of targets) {
    for (const name of names) {
      if (fs.existsSync(path.join(target.path, name))) conflicts.push(path.join(target.path, name));
    }
  }
  return conflicts;
}

/** The release a folder of installed jev skills came from, or null when there is none. */
export function installedVersion(targetPath) {
  for (const name of ['jev-setup', 'jev-ask']) {
    const file = path.join(targetPath, name, 'VERSION');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  }
  return null;
}

/**
 * Points a skill at the installed CLI. Claude Code fills in ${CLAUDE_PLUGIN_ROOT} only for
 * plugin skills, and no other agent fills it in at all, so an installed copy carries the
 * absolute path instead. The footer about JEV_HOME no longer applies and is replaced.
 */
export function rewriteSkill(text, { runtimeDir, version }) {
  const root = runtimeDir.replace(/\\/g, '/');
  let body = text.replace(/\r\n/g, '\n').split(PLACEHOLDER).join(root);
  const footer = body.indexOf(FOOTER_HEADING);
  if (footer !== -1) body = body.slice(0, footer).trimEnd() + '\n';
  return body + [
    '',
    '## About this copy',
    '',
    `Installed by \`npx jev-ai\` ${version}. The jev CLI lives in \`${root}\`. A line that starts`,
    'with `!` is a command: Claude Code runs it before you read this and puts its output in its',
    'place. If your agent did not, run that command yourself first and read its output.',
    '',
  ].join('\n');
}

function copyTree(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

export function installRuntime({ source, runtimeDir, version }) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  copyTree(source, path.join(runtimeDir, 'scripts'));
  fs.writeFileSync(path.join(runtimeDir, 'VERSION'), version + '\n');
}

/** Writes every skill into every target. An existing folder is replaced only with overwrite. */
export function installSkills({ skillsDir, targets, runtimeDir, version, overwrite = false }) {
  const written = [];
  for (const target of targets) {
    for (const skill of listSkills(skillsDir)) {
      const dest = path.join(target.path, skill.name);
      if (fs.existsSync(dest) && !overwrite) continue;
      copyTree(path.join(skillsDir, skill.source), dest);
      const file = path.join(dest, 'SKILL.md');
      fs.writeFileSync(file, rewriteSkill(fs.readFileSync(file, 'utf8'), { runtimeDir, version }));
      fs.writeFileSync(path.join(dest, 'VERSION'), version + '\n');
      written.push({ name: skill.name, path: dest, agents: target.agents.map((a) => a.id) });
    }
  }
  return written;
}

/** The two `claude` commands that install the plugin, hooks included, at the chosen scope. */
export function claudePluginCommands(location) {
  const scope = location === 'global' ? 'user' : 'project';
  return [
    ['plugin', 'marketplace', 'add', MARKETPLACE, '--scope', scope],
    ['plugin', 'install', PLUGIN, '--scope', scope],
  ];
}
