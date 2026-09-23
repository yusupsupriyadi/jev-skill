#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { loadConfig } from './lib/config.mjs';
import { emit, makeLogger, promptSubmitContext, readStdin, runHook } from './lib/hook-io.mjs';
import { decide, JevError } from './lib/jev-client.mjs';
import { discoverCatalog } from './lib/catalog.mjs';
import { formatJudgeReport } from './lib/format.mjs';
import { consumeJudgment, renderRoute, route, shouldSkipPrompt } from './hooks/route.mjs';
import { alreadyJudged, judge, markJudged, storeJudgment } from './hooks/judge.mjs';
import { PROVIDERS, PROVIDER_IDS } from './lib/providers.mjs';
import { clearStore, mirrorPluginOptions, probeProvider, runSetup } from './lib/setup.mjs';
import { detectHost, detectPlatforms, getPlatform } from './lib/platforms.mjs';

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[name] = true;
      else {
        flags[name] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

/** Accepts inline JSON or @path so a skill can hand over a file it just wrote. */
function readJsonArg(value, label) {
  if (typeof value !== 'string' || value === '') throw new Error('--' + label + ' is required');
  const text = value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('--' + label + ' is not valid JSON: ' + error.message);
  }
}

function requireKey(config) {
  if (!config.apiKey) {
    console.error('No API key for ' + config.providerLabel + '. Run /jev:setup, or set '
      + PROVIDERS[config.provider].envKey + '.');
    process.exit(1);
  }
}

/**
 * Ends the process without a bare exit. Killing it while fetch is still closing a socket
 * aborts on Windows with a libuv assertion, which looks like a crash to the caller.
 */
function finish(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 250).unref();
}

/** Reads a secret from stdin so it never lands in shell history or the process list. */
function readSecretStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => resolve(raw.trim()));
    process.stdin.on('error', () => resolve(''));
  });
}

async function cmdSetup(flags) {
  const config = loadConfig();

  if (flags.status) {
    console.log('provider: ' + config.provider + ' (' + config.providerReason + ')');
    console.log('key:      ' + (config.apiKey ? 'set, via ' + config.apiKeySource : 'not set'));
    console.log('model:    ' + config.model);
    console.log('endpoint: ' + config.apiUrl);
    return;
  }

  if (flags.reset) {
    console.log(clearStore(config.storeDir) ? 'Stored settings removed.' : 'Nothing stored to remove.');
    return;
  }

  const providerId = typeof flags.provider === 'string' ? flags.provider : config.provider;
  if (!PROVIDERS[providerId]) {
    console.error('Unknown provider "' + providerId + '". Choose one of: ' + PROVIDER_IDS.join(', '));
    process.exit(1);
  }

  const apiKey = flags.key === '-' ? await readSecretStdin() : flags.key;
  const result = await runSetup({
    providerId,
    apiKey: typeof apiKey === 'string' ? apiKey.trim() : '',
    storeDir: config.storeDir,
  });

  if (!result.ok) {
    console.error(result.error);
    for (const attempt of result.attempts || []) console.error('  ' + attempt.model + ': ' + attempt.error);
    if (result.keyUrl) console.error('Get a key at ' + result.keyUrl);
    finish(1);
    return;
  }

  console.log('Connected to ' + result.providerLabel + '.');
  console.log('  model:    ' + result.model + (result.resolvedModel !== result.model ? ' -> ' + result.resolvedModel : ''));
  console.log('  latency:  ' + result.latencyMs + ' ms');
  if (result.cost !== null) console.log('  cost:     $' + Number(result.cost).toFixed(6) + ' for that probe');
  console.log('  saved to: ' + result.storedAt);
  console.log('\njev is live. Routing and judging start on your next prompt.');
}

async function cmdDecide(flags) {
  const config = loadConfig();
  requireKey(config);
  const state = readJsonArg(flags.state, 'state');
  const questions = readJsonArg(flags.questions, 'questions');
  const response = await decide({
    state,
    questions,
    model: flags.model || config.model,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    timeoutMs: 10000,
  });
  console.log(JSON.stringify(response, null, 2));
}

async function cmdRoute(positional) {
  const config = loadConfig();
  requireKey(config);
  const prompt = positional.join(' ').trim();
  if (!prompt) {
    console.error('Usage: cli.mjs route "<what you want to do>"');
    process.exit(1);
  }
  const started = Date.now();
  const result = await route({ prompt, config, log: makeLogger(config) });
  if (!result) {
    console.log('Jev did not find a skill worth suggesting for this request.');
    return;
  }
  console.log(renderRoute(result));
  console.log('\nSearched ' + result.catalogSize + ' catalog entries in ' + (Date.now() - started) + ' ms.');
}

async function cmdJudge(flags) {
  const config = loadConfig();
  requireKey(config);
  const files = typeof flags.files === 'string'
    ? flags.files.split(',').map((f) => f.trim()).filter(Boolean)
    : null;
  const result = await judge({
    config,
    files,
    staged: Boolean(flags.staged),
    log: makeLogger(config),
  });
  if (!result) {
    console.log('Nothing to judge: no changed files found in the working tree.');
    return;
  }
  console.log('Judged ' + result.files.length + ' changed file(s): ' + result.files.join(', ') + '\n');
  console.log(formatJudgeReport(result.answers, result.findings));
  if (result.usage) console.log('\nCost: $' + Number(result.usage.cost || 0).toFixed(6));
}

function cmdCatalog(flags) {
  const config = loadConfig();
  const catalog = discoverCatalog({
    configDir: config.configDir,
    cwd: config.cwd,
    includeAgents: config.includeAgents,
    routeExclude: config.routeExclude,
    extraPluginDirs: config.extraPluginDirs,
  });
  if (flags.json) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }
  const byNamespace = {};
  for (const entry of catalog) {
    const namespace = entry.id.includes(':') ? entry.id.split(':')[0] : '(local)';
    byNamespace[namespace] = (byNamespace[namespace] || 0) + 1;
  }
  console.log(catalog.length + ' routable entries');
  for (const [namespace, count] of Object.entries(byNamespace).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + namespace + ': ' + count);
  }
}

async function cmdDoctor() {
  const config = loadConfig();
  console.log('jev doctor');
  console.log('  node:        ' + process.version);
  console.log('  config dir:  ' + config.configDir);
  console.log('  key store:   ' + config.storeDir);
  console.log('  data dir:    ' + config.dataDir);
  const host = detectHost();
  const hostPlatform = host ? getPlatform(host) : null;
  console.log('  host agent:  ' + (hostPlatform ? hostPlatform.label : 'unknown, scanning every agent'));
  const present = detectPlatforms({ cwd: config.cwd, configDir: config.configDir });
  console.log('  agents here: ' + (present.length ? present.join(', ') : 'none found'));
  console.log('  provider:    ' + config.providerLabel + ' (' + config.providerReason + ')');
  console.log('  api url:     ' + config.apiUrl);
  console.log('  model:       ' + config.model);
  console.log('  routing:     ' + (config.routeEnabled ? 'on' : 'off') + ' (min confidence ' + config.routeMinConfidence + ')');
  console.log('  judging:     ' + (config.judgeEnabled ? 'on' : 'off') + ' (send diff: ' + config.sendDiff + ')');
  console.log('  api key:     ' + (config.apiKey ? 'found via ' + config.apiKeySource : 'MISSING'));

  const catalog = discoverCatalog({
    configDir: config.configDir,
    cwd: config.cwd,
    includeAgents: config.includeAgents,
    routeExclude: config.routeExclude,
    extraPluginDirs: config.extraPluginDirs,
  });
  console.log('  catalog:     ' + catalog.length + ' routable entries');

  if (!config.apiKey) {
    console.log('\nNo key yet. Run /jev:setup to connect TypeSafe or OpenRouter, or set '
      + PROVIDERS.typesafe.envKey + ' or ' + PROVIDERS.openrouter.envKey + '.');
    console.log('A key entered through /plugin is picked up here from the next session onward.');
    return;
  }

  // Try the configured slug first, then the provider's other slugs, so a renamed model
  // shows up as "use this one instead" rather than a flat failure.
  const models = [config.model, ...config.models.filter((m) => m !== config.model)];
  const result = await probeProvider({
    provider: config.provider,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    models,
  });

  if (result.ok) {
    console.log('\n  OK  ' + result.model
      + (result.resolvedModel !== result.model ? ' -> ' + result.resolvedModel : ''));
    console.log('      answer ' + result.answer + ', ' + result.latencyMs + ' ms'
      + (result.cost !== null ? ', cost $' + Number(result.cost).toFixed(6) : ''));
    if (result.attempts.length > 0) {
      console.log('      note: ' + result.attempts[0].model + ' failed, set JEV_MODEL to the working slug');
    }
    return;
  }

  for (const attempt of result.attempts) console.log('\n  FAIL ' + attempt.model + ': ' + attempt.error);
  console.log('\nNo model slug worked on ' + config.providerLabel + '. Check the key and credit at '
    + config.providerKeyUrl + ', or run /jev:setup to switch provider.');
}

/** Hooks are the only place /plugin options arrive, so copy them where the skills can read them. */
function mirrorOptions(config) {
  try {
    mirrorPluginOptions(config.storeDir);
  } catch {
    /* a read-only home directory must not break the hook */
  }
}

async function hookSessionStart() {
  const config = loadConfig();
  mirrorOptions(config);
  if (config.apiKey) return;
  if (!config.routeEnabled && !config.judgeEnabled) return;
  emit({
    systemMessage: 'jev has no API key yet, so it stays idle. '
      + 'Run /jev:setup to connect TypeSafe or OpenRouter.',
  });
}

async function hookRoute() {
  const input = await readStdin();
  const config = loadConfig();
  const log = makeLogger(config);
  mirrorOptions(config);
  if (!config.apiKey) return;

  const sessionId = input.session_id || null;
  const blocks = [];

  const recall = consumeJudgment(config, sessionId);
  if (recall) blocks.push(recall);

  const prompt = input.user_prompt || '';
  if (config.routeEnabled && !shouldSkipPrompt(prompt)) {
    try {
      const result = await route({ prompt, config, log, sessionId });
      const rendered = renderRoute(result);
      if (rendered) blocks.push(rendered);
    } catch (error) {
      log('route failed', error.message);
    }
  }

  if (blocks.length > 0) emit(promptSubmitContext(blocks.join('\n\n')));
}

async function hookJudge() {
  const input = await readStdin();
  const config = loadConfig();
  const log = makeLogger(config);
  if (!config.judgeEnabled || !config.apiKey) return;

  const promptId = input.prompt_id || null;
  if (alreadyJudged(config, promptId)) {
    log('already judged', promptId);
    return;
  }
  markJudged(config, promptId);

  const result = await judge({
    config,
    transcriptPath: input.transcript_path || null,
    promptId,
    finalMessage: input.last_assistant_message || '',
    sessionId: input.session_id || null,
    log,
  });
  if (!result) return;
  storeJudgment(config, { sessionId: input.session_id || null, promptId, result });
  log('judged', result.findings.map((f) => f.key));
  // Stop hooks cannot inject context or show a message, so nothing goes to stdout.
}

const HOOKS = {
  'session-start': hookSessionStart,
  route: hookRoute,
  judge: hookJudge,
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);

  if (command === 'hook') {
    const handler = HOOKS[positional[0]];
    if (!handler) process.exit(0);
    await runHook(positional[0], handler);
    return;
  }

  try {
    switch (command) {
      case 'decide':
        await cmdDecide(flags);
        break;
      case 'route':
        await cmdRoute(positional);
        break;
      case 'judge':
        await cmdJudge(flags);
        break;
      case 'catalog':
        cmdCatalog(flags);
        break;
      case 'doctor':
        await cmdDoctor();
        break;
      case 'setup':
        await cmdSetup(flags);
        break;
      default:
        console.log('Usage: cli.mjs <setup|decide|route|judge|catalog|doctor|hook>');
        console.log('  setup --provider <typesafe|openrouter> --key <key|->');
        console.log('  setup --status | --reset');
        console.log('  decide --state <json|@file> --questions <json|@file> [--model <slug>]');
        console.log('  route "<what you want to do>"');
        console.log('  judge [--staged] [--files a,b]');
        console.log('  catalog [--json]');
        console.log('  doctor');
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    const message = error instanceof JevError ? error.message : (error && error.message) || String(error);
    console.error('jev: ' + message);
    finish(1);
  }
}

main();
