import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, isTruthy } from './frontmatter.mjs';

const MAX_DESCRIPTION = 200;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readTextHead(file, bytes = 8192) {
  try {
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const read = fs.readSync(handle, buffer, 0, bytes, 0);
      return buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return '';
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function listFiles(dir, extension) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(extension))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function walkFiles(dir, extension, depth = 3) {
  const found = [];
  if (depth < 0) return found;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) found.push(full);
    else if (entry.isDirectory()) found.push(...walkFiles(full, extension, depth - 1));
  }
  return found;
}

function describe(meta, fallbackName) {
  const parts = [];
  if (meta.description) parts.push(String(meta.description));
  if (meta.when_to_use) parts.push(String(meta.when_to_use));
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return fallbackName;
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION - 1) + '…' : text;
}

function makeEntry({ id, kind, file, source }) {
  const meta = parseFrontmatter(readTextHead(file));
  // A skill Claude is not allowed to invoke is useless as a routing target.
  if (isTruthy(meta['disable-model-invocation'])) return null;
  return { id, kind, description: describe(meta, id), source };
}

/** Merges enabledPlugins across user and project settings; later files win. */
export function readEnabledPlugins({ configDir, cwd }) {
  const files = [
    path.join(configDir, 'settings.json'),
    path.join(configDir, 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
  ];
  const enabled = new Map();
  for (const file of files) {
    const settings = readJson(file);
    if (!settings || !settings.enabledPlugins) continue;
    for (const [name, value] of Object.entries(settings.enabledPlugins)) enabled.set(name, value === true);
  }
  return [...enabled.entries()].filter(([, on]) => on).map(([name]) => name);
}

/**
 * Picks the install path for a plugin. installed_plugins.json v2 keeps one entry per
 * scope, and some plugins exist only at project scope, so prefer an entry whose
 * projectPath contains the cwd before falling back to the user-scope entry.
 */
export function resolveInstallPath(entries, cwd) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const normalized = path.resolve(cwd).toLowerCase();
  const projectMatch = entries.find((entry) => {
    if (entry.scope !== 'project' || !entry.projectPath) return false;
    const base = path.resolve(entry.projectPath).toLowerCase();
    return normalized === base || normalized.startsWith(base + path.sep);
  });
  const chosen = projectMatch || entries.find((entry) => entry.scope === 'user') || entries[0];
  return chosen && chosen.installPath ? chosen.installPath : null;
}

function collectFromPluginRoot(root, pluginName, includeAgents) {
  const entries = [];
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json')) || {};
  const namespace = pluginName || manifest.name;
  if (!namespace) return entries;

  const skillsDir = typeof manifest.skills === 'string'
    ? path.resolve(root, manifest.skills)
    : path.join(root, 'skills');
  for (const dir of listDirs(skillsDir)) {
    const file = path.join(skillsDir, dir, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const entry = makeEntry({ id: namespace + ':' + dir, kind: 'skill', file, source: 'plugin' });
    if (entry) entries.push(entry);
  }

  for (const file of walkFiles(path.join(root, 'commands'), '.md', 2)) {
    const name = path.basename(file, path.extname(file));
    const entry = makeEntry({ id: namespace + ':' + name, kind: 'command', file, source: 'plugin' });
    if (entry) entries.push(entry);
  }

  if (includeAgents) {
    const agentsDir = path.join(root, 'agents');
    for (const name of listFiles(agentsDir, '.md')) {
      const file = path.join(agentsDir, name);
      const meta = parseFrontmatter(readTextHead(file));
      const agentName = meta.name || path.basename(name, '.md');
      entries.push({
        id: namespace + ':' + agentName,
        kind: 'agent',
        description: describe(meta, agentName),
        source: 'plugin',
      });
    }
  }
  return entries;
}

function collectPersonalSkills(configDir) {
  const entries = [];
  const skillsRoot = path.join(configDir, 'skills');
  for (const dir of listDirs(skillsRoot)) {
    const dirPath = path.join(skillsRoot, dir);

    if (dir === 'synced') {
      // synced/<uuid>_<uuid>/<name>/SKILL.md is invoked as /anthropic-skills:<name>
      for (const bucket of listDirs(dirPath)) {
        for (const name of listDirs(path.join(dirPath, bucket))) {
          const file = path.join(dirPath, bucket, name, 'SKILL.md');
          if (!fs.existsSync(file)) continue;
          const entry = makeEntry({ id: 'anthropic-skills:' + name, kind: 'skill', file, source: 'synced' });
          if (entry) entries.push(entry);
        }
      }
      continue;
    }

    // A skills-directory plugin carries its own manifest and namespaces its skills.
    if (fs.existsSync(path.join(dirPath, '.claude-plugin', 'plugin.json'))) {
      entries.push(...collectFromPluginRoot(dirPath, dir, true));
      continue;
    }

    const file = path.join(dirPath, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const entry = makeEntry({ id: dir, kind: 'skill', file, source: 'personal' });
    if (entry) entries.push(entry);
  }
  return entries;
}

function collectProjectLocal(cwd, includeAgents) {
  const entries = [];
  const base = path.join(cwd, '.claude');
  for (const dir of listDirs(path.join(base, 'skills'))) {
    const file = path.join(base, 'skills', dir, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const entry = makeEntry({ id: dir, kind: 'skill', file, source: 'project' });
    if (entry) entries.push(entry);
  }
  for (const file of walkFiles(path.join(base, 'commands'), '.md', 2)) {
    const name = path.basename(file, '.md');
    const entry = makeEntry({ id: name, kind: 'command', file, source: 'project' });
    if (entry) entries.push(entry);
  }
  if (includeAgents) {
    for (const name of listFiles(path.join(base, 'agents'), '.md')) {
      const file = path.join(base, 'agents', name);
      const meta = parseFrontmatter(readTextHead(file));
      const agentName = meta.name || path.basename(name, '.md');
      entries.push({ id: agentName, kind: 'agent', description: describe(meta, agentName), source: 'project' });
    }
  }
  return entries;
}

/**
 * Discovers every skill, command, and agent Claude could invoke in this session.
 * Plugins loaded with --plugin-dir are absent from the registry and cannot be found
 * automatically; JEV_EXTRA_PLUGIN_DIRS lets a user add those by hand.
 */
export function discoverCatalog({ configDir, cwd, includeAgents = true, routeExclude = [], extraPluginDirs = [] }) {
  const entries = [];
  const enabled = readEnabledPlugins({ configDir, cwd });
  const registry = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'));
  const plugins = registry && registry.plugins ? registry.plugins : {};

  for (const pluginId of enabled) {
    const installPath = resolveInstallPath(plugins[pluginId], cwd);
    if (!installPath || !fs.existsSync(installPath)) continue;
    entries.push(...collectFromPluginRoot(installPath, pluginId.split('@')[0], includeAgents));
  }

  for (const dir of extraPluginDirs) {
    if (fs.existsSync(dir)) entries.push(...collectFromPluginRoot(dir, null, includeAgents));
  }

  entries.push(...collectPersonalSkills(configDir));
  entries.push(...collectProjectLocal(cwd, includeAgents));

  const seen = new Set();
  const excludes = routeExclude.map((p) => p.toLowerCase());
  return entries.filter((entry) => {
    if (!entry || !entry.id) return false;
    const key = entry.kind + ':' + entry.id;
    if (seen.has(key)) return false;
    seen.add(key);
    const lower = entry.id.toLowerCase();
    // Never route to this plugin's own skills.
    if (lower === 'jev' || lower.startsWith('jev:')) return false;
    if (excludes.some((prefix) => lower.startsWith(prefix))) return false;
    return true;
  });
}
