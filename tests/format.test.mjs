import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findingsFrom, formatJudgmentRecall, formatRouteContext, formatRunnerUp, riskLabel, sizeLabel,
} from '../scripts/lib/format.mjs';

const noul = (value) => ({ type: 'noul', noul: value });
const score = (value, confidence = 0.9) => ({ type: 'score', score: value, confidence });

test('a confident claim with no verification is flagged', () => {
  const keys = findingsFrom({ claims_done: noul(0.95), has_evidence: noul(0.1) }).map((f) => f.key);
  assert.deepEqual(keys, ['unverified_claim']);
});

test('a claim backed by a passing check is not flagged', () => {
  const keys = findingsFrom({ claims_done: noul(0.95), has_evidence: noul(0.9) }).map((f) => f.key);
  assert.deepEqual(keys, []);
});

test('thresholds hold at the boundary', () => {
  assert.deepEqual(findingsFrom({ needs_tests: noul(0.69) }), []);
  assert.equal(findingsFrom({ needs_tests: noul(0.7) })[0].key, 'needs_tests');
  assert.deepEqual(findingsFrom({ risk: score(1.9) }), []);
  assert.equal(findingsFrom({ risk: score(2) })[0].key, 'risk');
});

test('a low-confidence reviewer pick is suppressed', () => {
  const low = { type: 'choice', choice: 'ecc:security-reviewer', confidence: 0.4 };
  const high = { type: 'choice', choice: 'ecc:security-reviewer', confidence: 0.8 };
  assert.deepEqual(findingsFrom({ reviewer: low }), []);
  assert.equal(findingsFrom({ reviewer: high })[0].key, 'reviewer');
});

test('a reviewer choice of none is never a finding', () => {
  assert.deepEqual(findingsFrom({ reviewer: { type: 'choice', choice: 'none', confidence: 0.99 } }), []);
});

test('score labels map onto their rubric', () => {
  assert.equal(sizeLabel(score(0.2)), 'quick');
  assert.equal(sizeLabel(score(1.6)), 'major');
  assert.equal(riskLabel(score(3)), 'high');
  assert.equal(riskLabel(null), null);
});

test('the route block separates the winner share from the chance any skill fits', () => {
  const text = formatRouteContext({
    pick: 'superpowers:test-driven-development',
    description: 'Write the test first',
    confidence: 0.84,
    relevance: 1,
    runnerUp: 'ecc:tdd-workflow (0.12)',
    agent: 'ecc:code-reviewer',
    agentConfidence: 0.7,
    size: 'standard',
    sizeConfidence: 0.77,
  });
  assert.match(text, /superpowers:test-driven-development \(0\.84 of the vote, 1\.00 that some skill fits\)/);
  assert.match(text, /Close second: ecc:tdd-workflow \(0\.12\)/);
  assert.match(text, /ecc:code-reviewer/);
  assert.match(text, /standard/);
  assert.match(text, /not an instruction/);
});

test('none is reported as relevance, never as a runner-up skill', () => {
  const split = { choice: 'a', probabilities: { a: 0.5, none: 0.3, b: 0.2 } };
  assert.equal(formatRunnerUp(split), 'b (0.20)');
  const onlyNone = { choice: 'a', probabilities: { a: 0.7, none: 0.3 } };
  assert.equal(formatRunnerUp(onlyNone), null);
});

test('recall renders nothing when there are no findings', () => {
  assert.equal(formatJudgmentRecall({ findings: [] }), null);
  assert.equal(formatJudgmentRecall(null), null);
  assert.match(formatJudgmentRecall({ findings: [{ key: 'risk', text: 'Risky.' }] }), /Risky\./);
});
