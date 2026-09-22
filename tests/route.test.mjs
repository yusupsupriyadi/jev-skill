import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consumeJudgment, shouldSkipPrompt } from '../scripts/hooks/route.mjs';
import { alreadyJudged, markJudged, storeJudgment } from '../scripts/hooks/judge.mjs';

function tempConfig() {
  return { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jev-data-')) };
}

test('slash commands, acknowledgements and stubs are skipped without a round trip', () => {
  for (const prompt of ['/jev:doctor', 'ok', 'lanjut', 'thanks', 'ya', '   ', 'hm']) {
    assert.equal(shouldSkipPrompt(prompt), true, prompt);
  }
});

test('real requests are routed', () => {
  for (const prompt of ['tolong perbaiki bug login di safari', 'add a rate limiter to the API']) {
    assert.equal(shouldSkipPrompt(prompt), false, prompt);
  }
});

test('a judgment written by the Stop hook is replayed once and then gone', () => {
  const config = tempConfig();
  const result = { findings: [{ key: 'needs_tests', text: 'Add a test.' }], files: ['a.ts'] };
  assert.equal(storeJudgment(config, { sessionId: 's1', promptId: 'p1', result }), true);

  const first = consumeJudgment(config, 's1');
  assert.match(first, /Add a test\./);
  assert.equal(consumeJudgment(config, 's1'), null, 'consumed exactly once');
});

test('a judgment from another session is ignored', () => {
  const config = tempConfig();
  storeJudgment(config, {
    sessionId: 's1',
    promptId: 'p1',
    result: { findings: [{ key: 'risk', text: 'Risky.' }], files: [] },
  });
  assert.equal(consumeJudgment(config, 's2'), null);
});

test('a stale judgment is dropped', () => {
  const config = tempConfig();
  fs.writeFileSync(path.join(config.dataDir, 'last-judgment.json'), JSON.stringify({
    session_id: 's1',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    findings: [{ key: 'risk', text: 'Old.' }],
  }));
  assert.equal(consumeJudgment(config, 's1'), null);
});

test('a judgment with no findings is never stored', () => {
  const config = tempConfig();
  assert.equal(storeJudgment(config, { sessionId: 's', promptId: 'p', result: { findings: [], files: [] } }), false);
  assert.equal(consumeJudgment(config, 's'), null);
});

test('a prompt is judged at most once', () => {
  const config = tempConfig();
  assert.equal(alreadyJudged(config, 'p1'), false);
  markJudged(config, 'p1');
  assert.equal(alreadyJudged(config, 'p1'), true);
  assert.equal(alreadyJudged(config, 'p2'), false);
  assert.equal(alreadyJudged(config, null), false);
});
