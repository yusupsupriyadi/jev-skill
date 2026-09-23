import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { changedFilesFromGit, collectDiff, judge } from '../scripts/hooks/judge.mjs';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr);
  return result.stdout;
}

/** A throwaway repo with one committed file, so tests can dirty it however they need. */
function tempRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-judge-'));
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'test');
  git(cwd, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(cwd, 'app.js'), 'export const a = 1;\n');
  git(cwd, 'add', 'app.js');
  git(cwd, 'commit', '-q', '-m', 'init');
  return cwd;
}

function config(cwd) {
  return { cwd, sendDiff: true, configDir: cwd, routeExclude: [], extraPluginDirs: [], timeoutMs: 2500 };
}

test('a new file that git does not track yet counts as changed', () => {
  const cwd = tempRepo();
  fs.writeFileSync(path.join(cwd, 'app.js'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(cwd, 'secret.js'), 'const KEY = "sk_live_example";\n');
  assert.deepEqual(changedFilesFromGit(cwd).sort(), ['app.js', 'secret.js']);
});

test('the diff carries the contents of an untracked file', () => {
  const cwd = tempRepo();
  fs.writeFileSync(path.join(cwd, 'secret.js'), 'const KEY = "sk_live_example";\n');
  const diff = collectDiff({ cwd, files: ['secret.js'] });
  assert.match(diff, /\+\+\+ b\/secret\.js/);
  assert.match(diff, /^\+const KEY = "sk_live_example";$/m);
});

test('an untracked file named by absolute path, as the transcript does, is still read', () => {
  const cwd = tempRepo();
  const file = path.join(cwd, 'new.js');
  fs.writeFileSync(file, 'export const b = 3;\n');
  assert.match(collectDiff({ cwd, files: [file] }), /^\+export const b = 3;$/m);
});

test('staged mode judges what is staged, and ignores untracked files', () => {
  const cwd = tempRepo();
  fs.writeFileSync(path.join(cwd, 'app.js'), 'export const a = 3;\n');
  git(cwd, 'add', 'app.js');
  fs.writeFileSync(path.join(cwd, 'scratch.js'), 'x\n');
  assert.deepEqual(changedFilesFromGit(cwd, { staged: true }), ['app.js']);
  assert.doesNotMatch(collectDiff({ cwd, files: ['app.js'], staged: true }), /scratch\.js/);
});

test('an on-demand judge of a clean tree makes no call at all', async () => {
  const cwd = tempRepo();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('a clean tree must not be sent to Jev');
  };
  try {
    assert.equal(await judge({ config: config(cwd) }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an on-demand judge skips the questions that need a transcript', async () => {
  const cwd = tempRepo();
  fs.writeFileSync(path.join(cwd, 'app.js'), 'export const a = 4;\n');
  const originalFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ answers: { needs_tests: { type: 'noul', noul: 0.2 } } }),
    };
  };
  try {
    const result = await judge({ config: { ...config(cwd), apiKey: 'k', apiUrl: 'http://127.0.0.1/x', model: 'm' } });
    assert.ok(result, 'a dirty tree is judged');
    assert.equal('claims_done' in sent.questions, false);
    assert.equal('has_evidence' in sent.questions, false);
    assert.ok('secrets' in sent.questions);
    assert.deepEqual(result.files, ['app.js']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
