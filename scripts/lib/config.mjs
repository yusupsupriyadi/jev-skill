import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROVIDERS, providerFromKey } from './providers.mjs';

export const DEFAULTS = {
  provider: 'typesafe',
  routeEnabled: true,
  judgeEnabled: true,
  routeMinConfidence: 0.5,
  includeAgents: true,
  routeExclude: '',
  sendDiff: true,
  timeoutMs: 2500,
};

export const STORE_FILE = 'config.json';

const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on']);
const BOOL_FALSE = new Set(['0', 'false', 'no', 'off']);

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return undefined;
}

function asBool(raw, fallback) {
  if (raw === undefined) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (BOOL_TRUE.has(value)) return true;
  if (BOOL_FALSE.has(value)) return false;
  return fallback;
}

function asNumber(raw, fallback, { min, max } = {}) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

// Plugin options reach hooks as CLAUDE_PLUGIN_OPTION_<KEY>. Casing has varied across
// Claude Code versions, so check the uppercase and the literal spelling.
function option(env, key) {
  return firstDefined(env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`], env[`CLAUDE_PLUGIN_OPTION_${key}`]);
}

export function storePath(dataDir) {
  return path.join(dataDir, STORE_FILE);
}

/** What /jev:setup wrote. Plugin options cannot be set programmatically, so the wizard owns this file. */
export function readStore(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(dataDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Chooses the provider, then the key for it. An explicit choice always wins; otherwise
 * whichever provider has a key available is the one that gets used.
 */
function resolveProvider(env, store) {
  const explicit = firstDefined(env.JEV_PROVIDER, option(env, 'provider'), store.provider);
  if (explicit && explicit !== 'auto' && PROVIDERS[explicit]) {
    return { id: explicit, reason: 'configured' };
  }
  for (const id of Object.keys(PROVIDERS)) {
    const provider = PROVIDERS[id];
    if (firstDefined(env[provider.envKey], option(env, provider.optionKey))) {
      return { id, reason: 'key found for ' + provider.label };
    }
  }
  const guessed = providerFromKey(store.api_key);
  if (guessed) return { id: guessed, reason: 'stored key looks like ' + PROVIDERS[guessed].label };
  return { id: DEFAULTS.provider, reason: 'default' };
}

function resolveKey(env, store, provider) {
  const fromEnv = firstDefined(env[provider.envKey]);
  if (fromEnv) return { key: fromEnv, source: provider.envKey + ' env var' };
  const fromOption = option(env, provider.optionKey);
  if (fromOption) return { key: fromOption, source: 'plugin option' };
  // A stored key only counts for the provider it was saved against.
  if (store.api_key && (!store.provider || store.provider === provider.id)) {
    return { key: String(store.api_key), source: 'jev setup' };
  }
  return { key: undefined, source: null };
}

export function loadConfig(env = process.env) {
  const configDir = firstDefined(env.CLAUDE_CONFIG_DIR) || path.join(os.homedir(), '.claude');
  const dataDir = firstDefined(env.CLAUDE_PLUGIN_DATA) || path.join(configDir, 'plugins', 'data', 'jev');
  const store = readStore(dataDir);

  const chosen = resolveProvider(env, store);
  const provider = PROVIDERS[chosen.id];
  const { key, source } = resolveKey(env, store, provider);
  const storedModel = store.provider === provider.id ? store.model : undefined;

  return {
    provider: provider.id,
    providerLabel: provider.label,
    providerReason: chosen.reason,
    providerKeyUrl: provider.keyUrl,
    apiKey: key,
    apiKeySource: source,
    apiUrl: firstDefined(env.JEV_API_URL, store.api_url) || provider.apiUrl,
    model: firstDefined(env.JEV_MODEL, option(env, 'model'), storedModel) || provider.models[0],
    models: provider.models,
    fallbackModel: provider.models[1] || provider.models[0],
    routeEnabled: asBool(
      firstDefined(env.JEV_ROUTE, option(env, 'route_enabled'), store.route_enabled),
      DEFAULTS.routeEnabled,
    ),
    judgeEnabled: asBool(
      firstDefined(env.JEV_JUDGE, option(env, 'judge_enabled'), store.judge_enabled),
      DEFAULTS.judgeEnabled,
    ),
    routeMinConfidence: asNumber(
      firstDefined(env.JEV_MIN_CONFIDENCE, option(env, 'route_min_confidence'), store.route_min_confidence),
      DEFAULTS.routeMinConfidence,
      { min: 0, max: 1 },
    ),
    includeAgents: asBool(firstDefined(env.JEV_INCLUDE_AGENTS, option(env, 'include_agents')), DEFAULTS.includeAgents),
    routeExclude: (
      firstDefined(env.JEV_ROUTE_EXCLUDE, option(env, 'route_exclude'), store.route_exclude) || DEFAULTS.routeExclude
    ).split(',').map((s) => s.trim()).filter(Boolean),
    sendDiff: asBool(firstDefined(env.JEV_SEND_DIFF, option(env, 'send_diff'), store.send_diff), DEFAULTS.sendDiff),
    timeoutMs: asNumber(
      firstDefined(env.JEV_TIMEOUT_MS, option(env, 'timeout_ms')),
      DEFAULTS.timeoutMs,
      { min: 500, max: 30000 },
    ),
    extraPluginDirs: (firstDefined(env.JEV_EXTRA_PLUGIN_DIRS) || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
    debug: asBool(firstDefined(env.JEV_DEBUG), false),
    configDir,
    dataDir,
    cwd: firstDefined(env.CLAUDE_PROJECT_DIR) || process.cwd(),
  };
}
