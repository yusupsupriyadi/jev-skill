#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pc from 'picocolors';
import { cancel, confirm, intro, isCancel, log, multiselect, note, outro, password, select, spinner } from '@clack/prompts';
import {
  AGENTS,
  VERSION,
  claudePluginCommands,
  detectAgents,
  detectConflicts,
  findSources,
  installRuntime,
  installSkills,
  installedVersion,
  listSkills,
  resolveTargets,
  runtimeDirFor,
} from './lib/install.mjs';

function stop(message) {
  cancel(message);
  process.exit(0);
}

function answer(value) {
  if (isCancel(value)) stop('Install cancelled.');
  return value;
}

// The arguments are fixed strings, never user input, so one command line through the shell
// is safe. It is what lets Windows find claude.cmd, and it avoids Node's warning about
// passing an argument array together with shell: true.
function runClaude(args) {
  return spawnSync(['claude', ...args].join(' '), { shell: true, encoding: 'utf8', timeout: 180000 });
}

function hasClaudeCli() {
  const result = runClaude(['--version']);
  return result.status === 0;
}

function runJev(runtimeDir, args, input) {
  return spawnSync(process.execPath, [path.join(runtimeDir, 'scripts', 'cli.mjs'), ...args], {
    encoding: 'utf8',
    input,
    timeout: 60000,
  });
}

function lastLines(text, count = 6) {
  return String(text || '').trim().split(/\r?\n/).slice(-count).join('\n');
}

async function connectProvider(runtimeDir) {
  const status = runJev(runtimeDir, ['setup', '--status']);
  if (status.status === 0 && /^key:\s+set/m.test(status.stdout)) {
    log.info('jev already has a key: ' + (/^key:\s+(.*)$/m.exec(status.stdout) || [])[1]);
    return;
  }

  const provider = answer(await select({
    message: 'jev needs a Jev API key. Connect one now?',
    options: [
      { value: 'typesafe', label: 'TypeSafe', hint: 'first-party API, key from console.typesafe.ai/keys' },
      { value: 'openrouter', label: 'OpenRouter', hint: 'needs prepaid credit, key from openrouter.ai/settings/keys' },
      { value: 'later', label: 'Later', hint: 'run the jev-setup skill, or set TYPESAFE_API_KEY or OPENROUTER_API_KEY' },
    ],
  }));
  if (provider === 'later') return;

  const key = answer(await password({ message: 'Paste the key. It is checked against the live API before anything is saved.' }));
  const spin = spinner();
  spin.start('Checking the key...');
  // The key goes in on stdin, so it never appears in the process list.
  const result = runJev(runtimeDir, ['setup', '--provider', provider, '--key', '-'], key.trim());
  if (result.status === 0) {
    spin.stop('Connected.');
    log.message(lastLines(result.stdout, 5));
  } else {
    spin.error('The key did not work, so nothing was saved.');
    log.message(lastLines(result.stderr || result.stdout));
  }
}

async function main() {
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log('jev-ai ' + VERSION);
    return;
  }

  // Without a terminal every prompt reads EOF at once and the run would exit 0 having
  // installed nothing, which a script around it would read as success.
  if (!process.stdin.isTTY) {
    console.error('jev-ai: this installer needs a terminal. Run `npx jev-ai` in an interactive shell.');
    process.exit(1);
  }

  intro(pc.bold('jev ' + VERSION) + pc.dim('  typed decisions for coding agents'));

  const sources = findSources();
  if (!sources) stop('Could not find the jev skills in this package. Reinstall jev-ai.');

  const location = answer(await select({
    message: 'Where should jev go?',
    options: [
      { value: 'project', label: 'This project', hint: process.cwd() },
      { value: 'global', label: 'Everywhere', hint: 'every project on this machine' },
    ],
  }));

  const detected = detectAgents({ location });
  const dirOf = (agent) => (location === 'global' ? '~/' + agent.global : agent.project);
  const chosen = answer(await multiselect({
    message: 'Which agents should get jev?',
    options: AGENTS.map((agent) => ({
      value: agent.id,
      label: agent.label,
      hint: detected.includes(agent.id) ? 'found (' + dirOf(agent) + ')' : 'will create ' + dirOf(agent),
    })),
    initialValues: detected,
    required: true,
  }));

  let pluginRoute = false;
  if (chosen.includes('claude')) {
    const route = answer(await select({
      message: 'How should Claude Code get jev?',
      options: [
        { value: 'plugin', label: 'As a plugin (recommended)', hint: 'adds a skill suggestion on every prompt and a judgment after every turn' },
        { value: 'skills', label: 'As skills only', hint: 'the five skills, run when you ask' },
      ],
    }));
    pluginRoute = route === 'plugin';
    if (pluginRoute && !hasClaudeCli()) {
      log.warn('The claude command is not on PATH, so Claude Code gets the skills only.');
      pluginRoute = false;
    }
  }

  const skillAgents = pluginRoute ? chosen.filter((id) => id !== 'claude') : chosen;
  const targets = resolveTargets({ location, agents: skillAgents });
  const names = listSkills(sources.skills).map((skill) => skill.name);
  const runtimeDir = runtimeDirFor();

  let overwrite = false;
  const conflicts = detectConflicts({ targets, names });
  if (conflicts.length > 0) {
    const found = [...new Set(targets.map((t) => installedVersion(t.path)).filter(Boolean))];
    log.warn('Already installed: jev ' + (found.length ? found.join(' and ') : 'of an unknown version') + '. This installer carries ' + VERSION + '.');
    overwrite = answer(await select({
      message: conflicts.length + ' jev skill folder(s) already exist.',
      options: [
        { value: true, label: 'Overwrite them', hint: 'update to ' + VERSION },
        { value: false, label: 'Keep what is there', hint: 'leave those folders as they are' },
      ],
    }));
  }

  const plan = ['CLI         ' + runtimeDir];
  for (const target of targets) plan.push('skills      ' + target.path + pc.dim('  ' + target.agents.map((a) => a.label).join(', ')));
  if (pluginRoute) plan.push('plugin      ' + 'jev@jev-skill for Claude Code, ' + (location === 'global' ? 'user' : 'project') + ' scope');
  note(plan.join('\n'), 'About to install');
  if (!answer(await confirm({ message: 'Go ahead?', initialValue: true }))) stop('Install cancelled.');

  const spin = spinner();
  spin.start('Installing...');
  installRuntime({ source: sources.runtime, runtimeDir, version: VERSION });
  const written = installSkills({ skillsDir: sources.skills, targets, runtimeDir, version: VERSION, overwrite });
  let pluginResult = null;
  if (pluginRoute) {
    for (const args of claudePluginCommands(location)) {
      pluginResult = runClaude(args);
      // Adding a marketplace that is already there fails, and the install still works.
      if (pluginResult.status !== 0 && args[1] !== 'marketplace') break;
    }
  }
  spin.stop('Installed.');

  const folders = new Set(written.map((w) => path.dirname(w.path)));
  if (written.length > 0) log.success(written.length + ' skills written into ' + folders.size + ' folder(s).');
  else if (targets.length > 0) log.info('Existing skill folders were kept. Run again and pick "Overwrite them" to update.');
  if (pluginResult) {
    if (pluginResult.status === 0) log.success('Claude Code plugin installed. Restart Claude Code to load it.');
    else log.error('The Claude Code plugin did not install:\n' + lastLines(pluginResult.stderr || pluginResult.stdout));
  }

  await connectProvider(runtimeDir);

  outro('Start a new agent session to load jev. Check it any time with the jev-doctor skill (' + pc.cyan('/jev:doctor') + ' in Claude Code).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
