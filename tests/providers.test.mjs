import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, readStore, storeDirFor } from '../scripts/lib/config.mjs';
import { getProvider, providerFromKey, PROVIDER_IDS } from '../scripts/lib/providers.mjs';
import { runSetup, saveStore } from '../scripts/lib/setup.mjs';

/** A fresh config dir per case, so no test can read a store another one wrote. */
function tempConfig() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jev-prov-'));
}

/** loadConfig reads process.env by default, so every case passes an explicit env. */
function env(extra = {}) {
  return { CLAUDE_CONFIG_DIR: tempConfig(), ...extra };
}

test('both providers are defined with an endpoint, a key name, and model slugs', () => {
  assert.deepEqual(PROVIDER_IDS.slice().sort(), ['openrouter', 'typesafe']);
  for (const id of PROVIDER_IDS) {
    const provider = getProvider(id);
    assert.match(provider.apiUrl, /^https:\/\//);
    assert.ok(provider.envKey.endsWith('_API_KEY'));
    assert.ok(provider.models.length >= 1);
    assert.match(provider.keyUrl, /^https:\/\//);
  }
  assert.equal(getProvider('nope'), null);
});

test('the two providers do not share an endpoint or a model slug', () => {
  const typesafe = getProvider('typesafe');
  const openrouter = getProvider('openrouter');
  assert.notEqual(typesafe.apiUrl, openrouter.apiUrl);
  assert.equal(typesafe.models.some((m) => openrouter.models.includes(m)), false);
});

test('an OpenRouter key is recognised by prefix, a TypeSafe key is not guessed', () => {
  assert.equal(providerFromKey('sk-or-v1-abc'), 'openrouter');
  assert.equal(providerFromKey('ts-abc'), null);
  assert.equal(providerFromKey(undefined), null);
});

test('TypeSafe is the default when nothing is configured', () => {
  const config = loadConfig(env());
  assert.equal(config.provider, 'typesafe');
  assert.equal(config.apiUrl, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(config.model, 'jev-latest');
  assert.equal(config.apiKey, undefined);
});

test('whichever provider has a key in the environment is the one selected', () => {
  const openrouter = loadConfig(env({ OPENROUTER_API_KEY: 'sk-or-x' }));
  assert.equal(openrouter.provider, 'openrouter');
  assert.equal(openrouter.apiUrl, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(openrouter.model, '~typesafe/jev-latest');

  const typesafe = loadConfig(env({ TYPESAFE_API_KEY: 'ts-x' }));
  assert.equal(typesafe.provider, 'typesafe');
  assert.equal(typesafe.apiKeySource, 'TYPESAFE_API_KEY env var');
});

test('an explicit provider wins over a key that belongs to the other one', () => {
  const config = loadConfig(env({
    OPENROUTER_API_KEY: 'sk-or-x',
    JEV_PROVIDER: 'typesafe',
  }));
  assert.equal(config.provider, 'typesafe');
  // The OpenRouter key must not leak into a TypeSafe request.
  assert.equal(config.apiKey, undefined);
});

test('a stored key is used, and only for the provider it was saved against', () => {
  const configDir = tempConfig();
  saveStore(storeDirFor(configDir), { provider: 'typesafe', api_key: 'stored-key', model: 'jev-latest' });

  const matching = loadConfig(env({ CLAUDE_CONFIG_DIR: configDir }));
  assert.equal(matching.provider, 'typesafe');
  assert.equal(matching.apiKey, 'stored-key');
  assert.equal(matching.apiKeySource, 'jev setup');

  const switched = loadConfig(env({ CLAUDE_CONFIG_DIR: configDir, JEV_PROVIDER: 'openrouter' }));
  assert.equal(switched.provider, 'openrouter');
  assert.equal(switched.apiKey, undefined, 'a TypeSafe key is never sent to OpenRouter');
});

test('an environment key beats a stored key', () => {
  const configDir = tempConfig();
  saveStore(storeDirFor(configDir), { provider: 'typesafe', api_key: 'stored-key' });
  const config = loadConfig(env({ CLAUDE_CONFIG_DIR: configDir, TYPESAFE_API_KEY: 'env-key' }));
  assert.equal(config.apiKey, 'env-key');
  assert.equal(config.apiKeySource, 'TYPESAFE_API_KEY env var');
});

test('setup stores the key only after the provider answers', async () => {
  const storeDir = storeDirFor(tempConfig());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: 'jev-1.13.0', answers: { is_problem: { type: 'noul', noul: 0.99 } } }),
  });
  try {
    const result = await runSetup({ providerId: 'typesafe', apiKey: 'good-key', storeDir });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'typesafe');
    assert.equal(result.model, 'jev-latest');
    const stored = readStore(storeDir);
    assert.equal(stored.api_key, 'good-key');
    assert.ok(Date.parse(stored.updated_at) > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a key that is refused is reported and never written to disk', async () => {
  const storeDir = storeDirFor(tempConfig());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => '' });
  try {
    const result = await runSetup({ providerId: 'typesafe', apiKey: 'bad-key', storeDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /did not work against TypeSafe/);
    assert.equal(result.attempts.length, 2, 'every model slug was tried');
    assert.deepEqual(readStore(storeDir), {}, 'nothing was stored');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('setup rejects an unknown provider and a missing key without calling out', async () => {
  const storeDir = storeDirFor(tempConfig());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('setup must not call out here');
  };
  try {
    assert.match((await runSetup({ providerId: 'nope', apiKey: 'k', storeDir })).error, /Unknown provider/);
    assert.match((await runSetup({ providerId: 'typesafe', apiKey: '', storeDir })).error, /No API key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
