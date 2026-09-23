import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverCatalog } from '../lib/catalog.mjs';
import { decide } from '../lib/jev-client.mjs';
import { judgeQuestions } from '../lib/questions.mjs';
import { findingsFrom } from '../lib/format.mjs';
import { summarizeTurn } from '../lib/transcript.mjs';
import { writeJsonFile } from '../lib/hook-io.mjs';

const MAX_DIFF_CHARS = 12000;
const MAX_FINAL_MESSAGE_CHARS = 4000;
const MAX_REVIEWERS = 30;
const MAX_FILES = 40;
const MAX_UNTRACKED_BYTES = 64 * 1024;

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

/** A path outside the work tree makes git reject the whole command, so drop those first. */
function insideCwd(cwd, files) {
  return (files || []).filter((file) => !path.relative(cwd, path.resolve(cwd, file)).startsWith('..'));
}

/** Files git does not track yet. `git diff` never shows them, and a new file is where a leaked key usually lands. */
function untrackedFiles(cwd, files = null) {
  const args = ['ls-files', '--others', '--exclude-standard', '-z'];
  if (files && files.length > 0) {
    const inside = insideCwd(cwd, files);
    if (inside.length === 0) return [];
    args.push('--', ...inside.slice(0, MAX_FILES));
  }
  const out = git(args, cwd);
  return out ? out.split('\0').filter(Boolean) : [];
}

/** An untracked file written out as the diff git would print once it is added. */
function newFileDiff(cwd, file) {
  let buffer;
  try {
    buffer = fs.readFileSync(path.resolve(cwd, file));
  } catch {
    return null;
  }
  if (buffer.length > MAX_UNTRACKED_BYTES || buffer.includes(0)) return null;
  const name = file.split(path.sep).join('/');
  const lines = buffer.toString('utf8').replace(/\n$/, '').split('\n');
  return [
    'diff --git a/' + name + ' b/' + name,
    'new file, not yet tracked by git',
    '--- /dev/null',
    '+++ b/' + name,
    '@@ -0,0 +1,' + lines.length + ' @@',
    ...lines.map((line) => '+' + line),
  ].join('\n');
}

/** Diff of the files a turn touched, truncated so a large change cannot blow the context. */
export function collectDiff({ cwd, files, staged = false, sendDiff = true }) {
  if (!sendDiff) return null;
  const args = ['--no-pager', 'diff', '--no-color'];
  if (staged) args.push('--staged');
  if (files && files.length > 0) {
    const inside = insideCwd(cwd, files);
    if (inside.length > 0) args.push('--', ...inside.slice(0, MAX_FILES));
  }
  const parts = [];
  const tracked = git(args, cwd);
  if (tracked && tracked.trim()) parts.push(tracked.trim());
  // Staged mode judges only what is staged, and an untracked file cannot be staged.
  if (!staged) {
    for (const file of untrackedFiles(cwd, files)) {
      const diff = newFileDiff(cwd, file);
      if (diff) parts.push(diff);
    }
  }
  if (parts.length === 0) return null;
  const joined = parts.join('\n');
  return joined.length > MAX_DIFF_CHARS
    ? joined.slice(0, MAX_DIFF_CHARS) + '\n[diff truncated]'
    : joined;
}

/** Changed files relative to cwd, including new ones git does not track yet. */
export function changedFilesFromGit(cwd, { staged = false } = {}) {
  const args = ['--no-pager', 'diff', '--name-only', '--relative'];
  if (staged) args.push('--staged');
  const out = git(args, cwd);
  const tracked = out ? out.split('\n').map((line) => line.trim()).filter(Boolean) : [];
  const untracked = staged ? [] : untrackedFiles(cwd);
  return [...new Set([...tracked, ...untracked])].slice(0, MAX_FILES);
}

function reviewerCandidates(config) {
  const catalog = discoverCatalog({
    configDir: config.configDir,
    cwd: config.cwd,
    includeAgents: true,
    routeExclude: config.routeExclude,
    extraPluginDirs: config.extraPluginDirs,
  });
  return catalog
    .filter((entry) => entry.kind === 'agent')
    .filter((entry) => /review|audit|security|quality/i.test(entry.id + ' ' + entry.description))
    .slice(0, MAX_REVIEWERS);
}

/**
 * Judges what a turn did. Returns null when there is nothing worth asking about, so a
 * read-only or conversational turn costs nothing.
 */
export async function judge({
  config,
  transcriptPath = null,
  promptId = null,
  finalMessage = '',
  sessionId = null,
  files = null,
  staged = false,
  log = () => {},
}) {
  // A manual /jev:judge has no transcript, so it judges the working tree and skips the
  // questions about what a turn claimed and ran: with nothing to read they only mislead.
  const onDemand = !transcriptPath;
  let summary;
  if (!onDemand) {
    summary = summarizeTurn({ transcriptPath, promptId });
  } else {
    summary = {
      filesChanged: files && files.length > 0 ? files : changedFilesFromGit(config.cwd, { staged }),
      commands: [],
      verificationCommands: [],
      failedCommands: [],
      finalMessage: '',
      touched: false,
    };
  }

  const changed = files && files.length > 0 ? files : summary.filesChanged;
  if (!summary.touched && changed.length === 0) {
    log('nothing to judge');
    return null;
  }

  const diff = collectDiff({ cwd: config.cwd, files: changed, staged, sendDiff: config.sendDiff });
  const message = String(finalMessage || summary.finalMessage || '').slice(0, MAX_FINAL_MESSAGE_CHARS);

  const state = { files_changed: changed.slice(0, MAX_FILES) };
  if (!onDemand) {
    state.final_message = message;
    state.commands_run = summary.commands.map((c) => ({ command: c.command, failed: c.failed }));
    state.verification_commands = summary.verificationCommands.map((c) => ({ command: c.command, failed: c.failed }));
  }
  if (diff) state.diff = diff;
  else state.diff_note = config.sendDiff ? 'No diff available.' : 'Diff withheld by configuration.';

  const reviewers = reviewerCandidates(config);
  const questions = judgeQuestions({ reviewers, includeTurn: !onDemand });
  log('judging', { files: changed.length, reviewers: reviewers.length, diff: diff ? diff.length : 0 });

  const response = await decide({
    state,
    questions,
    model: config.model,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    timeoutMs: Math.max(config.timeoutMs, 4000),
    sessionId,
  });

  const answers = response.answers || {};
  return {
    answers,
    findings: findingsFrom(answers),
    files: changed,
    usage: response.usage || null,
  };
}

const MARKER = 'last-judged-prompt-id';

export function alreadyJudged(config, promptId) {
  if (!promptId) return false;
  try {
    return fs.readFileSync(path.join(config.dataDir, MARKER), 'utf8').trim() === promptId;
  } catch {
    return false;
  }
}

export function markJudged(config, promptId) {
  if (!promptId) return;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, MARKER), promptId);
  } catch {
    /* the marker is an optimisation, not a correctness requirement */
  }
}

/** Parks the verdict for the route hook to replay on the next prompt. */
export function storeJudgment(config, { sessionId, promptId, result }) {
  if (!result || result.findings.length === 0) return false;
  return writeJsonFile(path.join(config.dataDir, 'last-judgment.json'), {
    session_id: sessionId,
    prompt_id: promptId,
    created_at: new Date().toISOString(),
    files: result.files,
    findings: result.findings,
  });
}
