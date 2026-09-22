import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Where each agent keeps its skills. Paths follow the cross-agent convention that
 * `npx skills add` installs into, so a skill directory written by any of these tools is
 * discoverable here. Several agents share `.agents/skills`, which is the point of it.
 */
export const PLATFORMS = [
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

export function getPlatform(id) {
  return PLATFORMS.find((p) => p.id === id) || null;
}

/**
 * Which agent is running this process. Only Claude Code can be identified from the
 * environment with any confidence, so everything else comes from JEV_PLATFORM. Guessing
 * wrong is worse than not guessing: it would offer skills the host cannot invoke.
 */
export function detectHost(env = process.env) {
  const forced = env.JEV_PLATFORM && String(env.JEV_PLATFORM).trim();
  if (forced && getPlatform(forced)) return forced;
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_CONFIG_DIR || env.CLAUDE_PROJECT_DIR) return 'claude';
  return null;
}

function exists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The skills directories worth scanning, deduplicated by real path. Given a host, only
 * that agent's directories are returned, because a skill the host cannot load is not a
 * routing candidate. With no host known, every directory is scanned as a best effort.
 */
export function skillRoots({ cwd, homeDir = os.homedir(), configDir = null, platformId = null } = {}) {
  const byPath = new Map();
  const wanted = platformId ? PLATFORMS.filter((p) => p.id === platformId) : PLATFORMS;

  const add = (dir, platform, scope) => {
    if (!dir || !exists(dir)) return;
    const key = path.resolve(dir).toLowerCase();
    const found = byPath.get(key);
    if (found) {
      if (!found.platforms.includes(platform.label)) found.platforms.push(platform.label);
      return;
    }
    byPath.set(key, { dir, scope, platforms: [platform.label] });
  };

  for (const platform of wanted) {
    // An explicit config dir overrides the home-relative guess for Claude Code.
    if (platform.id === 'claude' && configDir) add(path.join(configDir, 'skills'), platform, 'global');
    else add(path.join(homeDir, platform.global), platform, 'global');
    if (cwd) add(path.join(cwd, platform.project), platform, 'project');
  }

  return [...byPath.values()];
}

/** Which agents have a skills directory on this machine, for reporting in doctor. */
export function detectPlatforms({ cwd, homeDir = os.homedir(), configDir = null } = {}) {
  const labels = new Set();
  for (const root of skillRoots({ cwd, homeDir, configDir })) {
    for (const label of root.platforms) labels.add(label);
  }
  return [...labels];
}

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);
