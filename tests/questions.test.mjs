import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkEntries, dedupeById, finalQuestion, judgeQuestions, pickQuestion, triageQuestions, NONE,
} from '../scripts/lib/questions.mjs';
import { validateQuestions } from '../scripts/lib/jev-client.mjs';

function entries(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: 'ns:skill-' + String(i).padStart(3, '0'),
    kind: 'skill',
    description: 'Does thing number ' + i,
  }));
}

test('dedupeById keeps the first entry for a repeated id', () => {
  const list = [
    { id: 'a', kind: 'skill', description: 'first' },
    { id: 'a', kind: 'command', description: 'second' },
  ];
  const deduped = dedupeById(list);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].description, 'first');
});

test('chunks stay under the option ceiling', () => {
  const chunks = chunkEntries(entries(537));
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) assert.ok(chunk.length <= 200, 'chunk of ' + chunk.length);
  assert.equal(chunks.reduce((n, c) => n + c.length, 0), 537);
});

test('chunks split on character budget too', () => {
  const fat = entries(50).map((e) => ({ ...e, description: 'x'.repeat(2000) }));
  const chunks = chunkEntries(fat);
  assert.ok(chunks.length > 1);
});

test('every generated question passes the API validator', () => {
  const chunk = entries(10);
  validateQuestions(triageQuestions());
  validateQuestions(pickQuestion(chunk, { kind: 'skill' }));
  validateQuestions(finalQuestion(chunk, { kind: 'agent' }));
  validateQuestions(judgeQuestions({ reviewers: entries(3) }));
  validateQuestions(judgeQuestions({ reviewers: [] }));
});

test('a pick always offers an escape hatch', () => {
  const question = pickQuestion(entries(4), { kind: 'skill' });
  assert.ok(NONE in question.pick.criteria);
});

test('judge drops the reviewer question when there are no reviewers', () => {
  assert.equal('reviewer' in judgeQuestions({ reviewers: [] }), false);
  assert.equal('reviewer' in judgeQuestions({ reviewers: entries(2) }), true);
});
