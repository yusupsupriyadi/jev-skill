import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, readStore, storeDirFor } from '../scripts/lib/config.mjs';
import { mirrorPluginOptions, saveStore } from '../scripts/lib/setup.mjs';

function tempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jev-store-'));
}

// A hook gets CLAUDE_PLUGIN_DATA and the plugin options; a Bash command run by a skill
// gets neither. These two views of one install must agree on the key.
function hookEnv(configDir, extra = {}) {
  return {
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_PLUGIN_DATA: path.join(configDir, 'plugins', 'data', 'jev-jev-skill'),
    ...extra,
  };
}

function skillEnv(configDir, extra = {}) {
  return { CLAUDE_CONFIG_DIR: configDir, ...extra };
}

test('a key saved by /jev:setup is visible to the hooks as well as to the skills', () => {
  const configDir = tempConfigDir();
  saveStore(storeDirFor(configDir), { provider: 'openrouter', api_key: 'sk-or-saved' });

  const fromSkill = loadConfig(skillEnv(configDir));
  const fromHook = loadConfig(hookEnv(configDir));
  assert.equal(fromSkill.apiKey, 'sk-or-saved');
  assert.equal(fromHook.apiKey, 'sk-or-saved', 'the hook reads the same store as the skill');
  assert.equal(fromHook.provider, 'openrouter');
});

test('the hooks keep their own data dir for logs and the parked judgment', () => {
  const configDir = tempConfigDir();
  const fromHook = loadConfig(hookEnv(configDir));
  assert.equal(fromHook.dataDir, path.join(configDir, 'plugins', 'data', 'jev-jev-skill'));
  assert.equal(fromHook.storeDir, storeDirFor(configDir));
  assert.equal(loadConfig(skillEnv(configDir)).dataDir, storeDirFor(configDir));
});

test('a key entered through /plugin reaches the skills once a hook has mirrored it', () => {
  const configDir = tempConfigDir();
  const optionEnv = hookEnv(configDir, { CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY: 'sk-or-option' });

  assert.equal(loadConfig(skillEnv(configDir)).apiKey, undefined, 'nothing mirrored yet');
  assert.equal(mirrorPluginOptions(storeDirFor(configDir), optionEnv), true);

  const fromSkill = loadConfig(skillEnv(configDir));
  assert.equal(fromSkill.provider, 'openrouter');
  assert.equal(fromSkill.apiKey, 'sk-or-option');
  assert.equal(fromSkill.apiKeySource, 'plugin option');
});

test('a live plugin option beats the mirrored copy of it', () => {
  const configDir = tempConfigDir();
  mirrorPluginOptions(storeDirFor(configDir), hookEnv(configDir, { CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: 'old' }));
  const config = loadConfig(hookEnv(configDir, { CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: 'new' }));
  assert.equal(config.apiKey, 'new');
});

test('mirroring writes only on a change and drops an option that was cleared', () => {
  const configDir = tempConfigDir();
  const storeDir = storeDirFor(configDir);
  const withRoute = hookEnv(configDir, { CLAUDE_PLUGIN_OPTION_ROUTE_EXCLUDE: 'ecc:' });

  assert.equal(mirrorPluginOptions(storeDir, withRoute), true);
  assert.equal(mirrorPluginOptions(storeDir, withRoute), false, 'same options, no rewrite');
  assert.deepEqual(readStore(storeDir).plugin_options, { route_exclude: 'ecc:' });

  assert.equal(mirrorPluginOptions(storeDir, hookEnv(configDir)), true);
  assert.deepEqual(readStore(storeDir).plugin_options, {});
  assert.deepEqual(loadConfig(skillEnv(configDir)).routeExclude, []);
});

test('mirroring never creates a store when there is nothing to mirror', () => {
  const configDir = tempConfigDir();
  assert.equal(mirrorPluginOptions(storeDirFor(configDir), hookEnv(configDir)), false);
  assert.equal(fs.existsSync(path.join(storeDirFor(configDir), 'config.json')), false);
});

test('mirroring leaves the key saved by /jev:setup alone', () => {
  const configDir = tempConfigDir();
  const storeDir = storeDirFor(configDir);
  saveStore(storeDir, { provider: 'typesafe', api_key: 'ts-saved' });
  mirrorPluginOptions(storeDir, hookEnv(configDir, { CLAUDE_PLUGIN_OPTION_ROUTE_ENABLED: 'false' }));

  const stored = readStore(storeDir);
  assert.equal(stored.api_key, 'ts-saved');
  assert.equal(loadConfig(skillEnv(configDir)).routeEnabled, false);
});

test('a provider option of "auto" does not hide the provider saved by /jev:setup', () => {
  const configDir = tempConfigDir();
  // No sk-or- prefix, so only the stored choice can say this key belongs to OpenRouter.
  saveStore(storeDirFor(configDir), { provider: 'openrouter', api_key: 'or-saved' });
  const config = loadConfig(hookEnv(configDir, { CLAUDE_PLUGIN_OPTION_PROVIDER: 'auto' }));
  assert.equal(config.provider, 'openrouter');
  assert.equal(config.apiKey, 'or-saved');
});
