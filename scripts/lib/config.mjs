import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = {
  model: '~typesafe/jev-latest',
  fallbackModel: 'typesafe/jev-1.13',
  apiUrl: 'https://openrouter.ai/api/alpha/decisions',
  routeEnabled: true,
  judgeEnabled: true,
  routeMinConfidence: 0.5,
  includeAgents: true,
  routeExclude: '',
  sendDiff: true,
  timeoutMs: 2500,
};

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

export function loadConfig(env = process.env) {
  const configDir = firstDefined(env.CLAUDE_CONFIG_DIR) || path.join(os.homedir(), '.claude');
  const dataDir = firstDefined(env.CLAUDE_PLUGIN_DATA) || path.join(configDir, 'plugins', 'data', 'jev');

  return {
    apiKey: firstDefined(env.OPENROUTER_API_KEY, option(env, 'openrouter_api_key')),
    apiKeySource: env.OPENROUTER_API_KEY ? 'OPENROUTER_API_KEY env var'
      : option(env, 'openrouter_api_key') ? 'plugin option' : null,
    model: firstDefined(env.JEV_MODEL, option(env, 'model')) || DEFAULTS.model,
    fallbackModel: DEFAULTS.fallbackModel,
    apiUrl: firstDefined(env.JEV_API_URL) || DEFAULTS.apiUrl,
    routeEnabled: asBool(firstDefined(env.JEV_ROUTE, option(env, 'route_enabled')), DEFAULTS.routeEnabled),
    judgeEnabled: asBool(firstDefined(env.JEV_JUDGE, option(env, 'judge_enabled')), DEFAULTS.judgeEnabled),
    routeMinConfidence: asNumber(
      firstDefined(env.JEV_MIN_CONFIDENCE, option(env, 'route_min_confidence')),
      DEFAULTS.routeMinConfidence,
      { min: 0, max: 1 },
    ),
    includeAgents: asBool(firstDefined(env.JEV_INCLUDE_AGENTS, option(env, 'include_agents')), DEFAULTS.includeAgents),
    routeExclude: (firstDefined(env.JEV_ROUTE_EXCLUDE, option(env, 'route_exclude')) || DEFAULTS.routeExclude)
      .split(',').map((s) => s.trim()).filter(Boolean),
    sendDiff: asBool(firstDefined(env.JEV_SEND_DIFF, option(env, 'send_diff')), DEFAULTS.sendDiff),
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
