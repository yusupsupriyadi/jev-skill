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
    console.error('No OpenRouter API key. Set OPENROUTER_API_KEY, or configure the plugin with /plugin.');
    process.exit(1);
  }
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
  console.log('  data dir:    ' + config.dataDir);
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
    console.log('\nSet OPENROUTER_API_KEY or configure the plugin with /plugin, then run this again.');
    return;
  }

  const probe = {
    state: { text: 'The build failed with a type error.' },
    questions: {
      is_problem: {
        type: 'noul',
        instructions: 'Does this text describe something going wrong?',
        criteria: { true: 'Reports a failure or error', false: 'Reports success or says nothing about failure' },
      },
    },
  };

  for (const model of [config.model, config.fallbackModel]) {
    try {
      const started = Date.now();
      const response = await decide({
        ...probe,
        model,
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        timeoutMs: 10000,
      });
      const noul = response.answers.is_problem ? response.answers.is_problem.noul : null;
      const cost = response.usage && response.usage.cost ? response.usage.cost : 0;
      console.log('\n  OK  ' + model + ' -> ' + (response.model || model));
      console.log('      answer ' + noul + ', ' + (Date.now() - started) + ' ms, cost $' + Number(cost).toFixed(6));
      return;
    } catch (error) {
      console.log('\n  FAIL ' + model + ': ' + (error && error.message ? error.message : String(error)));
    }
  }
  console.log('\nNo model slug worked. Check credits at https://openrouter.ai/credits and the alpha endpoint path.');
}

async function hookSessionStart() {
  const config = loadConfig();
  if (config.apiKey) return;
  if (!config.routeEnabled && !config.judgeEnabled) return;
  emit({
    systemMessage: 'jev is installed but has no OpenRouter API key, so it stays idle. '
      + 'Set OPENROUTER_API_KEY or configure the plugin with /plugin.',
  });
}

async function hookRoute() {
  const input = await readStdin();
  const config = loadConfig();
  const log = makeLogger(config);
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
      default:
        console.log('Usage: cli.mjs <decide|route|judge|catalog|doctor|hook>');
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
    process.exit(1);
  }
}

main();
