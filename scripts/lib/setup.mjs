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

export function saveStore(dataDir, values) {
  const file = storePath(dataDir);
  const merged = { ...readStore(dataDir), ...values, updated_at: new Date().toISOString() };
  fs.mkdirSync(dataDir, { recursive: true });
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
export async function runSetup({ providerId, apiKey, dataDir, apiUrl = null, timeoutMs = 10000 }) {
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

  const file = saveStore(dataDir, {
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

export function clearStore(dataDir) {
  try {
    fs.unlinkSync(path.join(dataDir, 'config.json'));
    return true;
  } catch {
    return false;
  }
}
