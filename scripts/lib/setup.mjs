import fs from 'node:fs';
import path from 'node:path';
import { decide } from './jev-client.mjs';
import { getProvider } from './providers.mjs';
import { storePath, readStore } from './config.mjs';

/** The smallest possible real request, used to prove a key and a model slug work. */
export const PROBE = {
  state: { text: 'The build failed with a type error.' },
  questions: {
    is_problem: {
      type: 'noul',
      instructions: 'Does this text describe something going wrong?',
      criteria: {
        true: 'Reports a failure or an error',
        false: 'Reports success, or says nothing about failure',
      },
    },
  },
};

/** Tries each of a provider's model slugs and reports the first that answers. */
export async function probeProvider({ provider, apiKey, apiUrl, models, timeoutMs = 10000 }) {
  const attempts = [];
  for (const model of models) {
    const started = Date.now();
    try {
      const response = await decide({ ...PROBE, model, apiKey, apiUrl, timeoutMs });
      return {
        ok: true,
        provider,
        model,
        resolvedModel: response.model || model,
        answer: response.answers.is_problem ? response.answers.is_problem.noul : null,
        latencyMs: Date.now() - started,
        cost: response.usage && typeof response.usage.cost === 'number' ? response.usage.cost : null,
        attempts,
      };
    } catch (error) {
      attempts.push({ model, error: error && error.message ? error.message : String(error) });
    }
  }
  return { ok: false, provider, attempts };
}

export function saveStore(storeDir, values) {
  const file = storePath(storeDir);
  const merged = { ...readStore(storeDir), ...values, updated_at: new Date().toISOString() };
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), { mode: 0o600 });
  try {
    // A second chmod matters when the file already existed with looser permissions.
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows ignores POSIX modes */
  }
  return file;
}

/**
 * Verifies a key against its provider and stores it only once it answers, so a typo is
 * reported instead of being written to disk and failing silently on every later prompt.
 */
export async function runSetup({ providerId, apiKey, storeDir, apiUrl = null, timeoutMs = 10000 }) {
  const provider = getProvider(providerId);
  if (!provider) {
    return { ok: false, error: 'Unknown provider "' + providerId + '". Use typesafe or openrouter.' };
  }
  if (!apiKey) {
    return { ok: false, error: 'No API key given. Get one at ' + provider.keyUrl };
  }

  const url = apiUrl || provider.apiUrl;
  const result = await probeProvider({
    provider: provider.id,
    apiKey,
    apiUrl: url,
    models: provider.models,
    timeoutMs,
  });

  if (!result.ok) {
    return {
      ok: false,
      provider: provider.id,
      error: 'The key did not work against ' + provider.label + '.',
      attempts: result.attempts,
      keyUrl: provider.keyUrl,
    };
  }

  const file = saveStore(storeDir, {
    provider: provider.id,
    api_key: apiKey,
    model: result.model,
    api_url: url === provider.apiUrl ? undefined : url,
  });

  return {
    ok: true,
    provider: provider.id,
    providerLabel: provider.label,
    model: result.model,
    resolvedModel: result.resolvedModel,
    latencyMs: result.latencyMs,
    cost: result.cost,
    storedAt: file,
  };
}

const OPTION_PREFIX = 'CLAUDE_PLUGIN_OPTION_';

/**
 * Copies the plugin options Claude Code hands to a hook into the store, because a skill's
 * Bash command never receives them. A key entered through /plugin is then usable by
 * /jev:ask and the rest too. Writes only on a change, and an option cleared in /plugin
 * disappears from the copy on the next run.
 */
export function mirrorPluginOptions(storeDir, env = process.env) {
  const options = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(OPTION_PREFIX) || value === undefined || String(value).trim() === '') continue;
    options[name.slice(OPTION_PREFIX.length).toLowerCase()] = String(value).trim();
  }
  const store = readStore(storeDir);
  const current = store.plugin_options && typeof store.plugin_options === 'object' ? store.plugin_options : {};
  const sorted = (object) => JSON.stringify(Object.keys(object).sort().map((key) => [key, object[key]]));
  if (sorted(current) === sorted(options)) return false;
  saveStore(storeDir, { plugin_options: options });
  return true;
}

export function clearStore(storeDir) {
  try {
    fs.unlinkSync(path.join(storeDir, 'config.json'));
    return true;
  } catch {
    return false;
  }
}
