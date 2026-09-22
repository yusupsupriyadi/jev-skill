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

/** Diff of the files a turn touched, truncated so a large change cannot blow the context. */
export function collectDiff({ cwd, files, staged = false, sendDiff = true }) {
  if (!sendDiff) return null;
  const args = ['--no-pager', 'diff', '--no-color'];
  if (staged) args.push('--staged');
  if (files && files.length > 0) args.push('--', ...files.slice(0, MAX_FILES));
  const out = git(args, cwd);
  if (!out) return null;
  const trimmed = out.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_DIFF_CHARS
    ? trimmed.slice(0, MAX_DIFF_CHARS) + '\n[diff truncated]'
    : trimmed;
}

export function changedFilesFromGit(cwd) {
  const out = git(['--no-pager', 'diff', '--name-only'], cwd);
  if (!out) return [];
  return out.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, MAX_FILES);
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
  let summary;
  if (transcriptPath) {
    summary = summarizeTurn({ transcriptPath, promptId });
  } else {
    // Manual /jev:judge run: no transcript slice, judge the working tree instead.
    summary = {
      filesChanged: files && files.length > 0 ? files : changedFilesFromGit(config.cwd),
      commands: [],
      verificationCommands: [],
      failedCommands: [],
      finalMessage: '',
      touched: true,
    };
  }

  const changed = files && files.length > 0 ? files : summary.filesChanged;
  if (!summary.touched && changed.length === 0) {
    log('nothing to judge');
    return null;
  }

  const diff = collectDiff({ cwd: config.cwd, files: changed, staged, sendDiff: config.sendDiff });
  const message = String(finalMessage || summary.finalMessage || '').slice(0, MAX_FINAL_MESSAGE_CHARS);

  const state = {
    final_message: message,
    files_changed: changed.slice(0, MAX_FILES),
    commands_run: summary.commands.map((c) => ({ command: c.command, failed: c.failed })),
    verification_commands: summary.verificationCommands.map((c) => ({ command: c.command, failed: c.failed })),
  };
  if (diff) state.diff = diff;
  else state.diff_note = config.sendDiff ? 'No diff available.' : 'Diff withheld by configuration.';

  const reviewers = reviewerCandidates(config);
  const questions = judgeQuestions({ reviewers });
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
