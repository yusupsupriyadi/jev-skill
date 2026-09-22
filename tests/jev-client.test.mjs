import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, validateQuestions, confidenceOf, runnerUp, JevError } from '../scripts/lib/jev-client.mjs';

const KEY = 'sk-or-test';
const URL = 'https://openrouter.test/api/alpha/decisions';

function okResponse(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

test('a noul without both criteria sides is rejected before the round trip', () => {
  assert.throws(
    () => validateQuestions({ q: { type: 'noul', criteria: { true: 'yes' } } }),
    /both criteria.true and criteria.false/,
  );
});

test('a choice over 255 options is rejected', () => {
  const criteria = {};
  for (let i = 0; i < 256; i += 1) criteria['opt' + i] = 'desc';
  assert.throws(() => validateQuestions({ q: { type: 'choice', criteria } }), /over the 255 limit/);
});

test('an unknown question type is rejected', () => {
  assert.throws(() => validateQuestions({ q: { type: 'vibe' } }), /unknown type/);
});

test('decide posts model, state and questions to the decisions endpoint', async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => ({ answers: { q: { type: 'noul', noul: 0.9 } } }) };
  };
  await decide({
    state: { text: 'hi' },
    questions: { q: { type: 'noul', criteria: { true: 'a', false: 'b' } } },
    model: '~typesafe/jev-latest',
    apiKey: KEY,
    apiUrl: URL,
    sessionId: 'session-1',
    fetchImpl,
  });
  assert.equal(captured.url, URL);
  assert.equal(captured.init.headers.Authorization, 'Bearer ' + KEY);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, '~typesafe/jev-latest');
  assert.deepEqual(body.state, { text: 'hi' });
  assert.equal(body.session_id, 'session-1');
});

test('a missing key fails without calling out', async () => {
  await assert.rejects(
    () => decide({ state: {}, questions: { q: { type: 'noul' } }, apiKey: '', apiUrl: URL, fetchImpl: okResponse({}) }),
    (error) => error instanceof JevError && error.code === 'NO_KEY',
  );
});

test('402 explains that credits are required', async () => {
  const fetchImpl = async () => ({ ok: false, status: 402, text: async () => '' });
  await assert.rejects(
    () => decide({
      state: {},
      questions: { q: { type: 'noul', criteria: { true: 'a', false: 'b' } } },
      apiKey: KEY,
      apiUrl: URL,
      fetchImpl,
    }),
    /credits required/i,
  );
});

test('a timeout surfaces as a JevError, not an unhandled abort', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  await assert.rejects(
    () => decide({
      state: {},
      questions: { q: { type: 'noul', criteria: { true: 'a', false: 'b' } } },
      apiKey: KEY,
      apiUrl: URL,
      timeoutMs: 20,
      fetchImpl,
    }),
    (error) => error instanceof JevError && error.code === 'TIMEOUT',
  );
});

test('a body without answers is an error', async () => {
  await assert.rejects(
    () => decide({
      state: {},
      questions: { q: { type: 'noul', criteria: { true: 'a', false: 'b' } } },
      apiKey: KEY,
      apiUrl: URL,
      fetchImpl: okResponse({ model: 'x' }),
    }),
    /no answers field/,
  );
});

test('confidence falls back to distance from 0.5 for a noul', () => {
  assert.equal(confidenceOf({ type: 'choice', confidence: 0.75 }), 0.75);
  assert.equal(confidenceOf({ type: 'noul', noul: 1 }), 1);
  assert.equal(confidenceOf({ type: 'noul', noul: 0.5 }), 0);
});

test('runnerUp reports the second-best option', () => {
  const answer = { choice: 'a', probabilities: { a: 0.7, b: 0.2, c: 0.1 } };
  assert.deepEqual(runnerUp(answer), { option: 'b', probability: 0.2 });
  assert.equal(runnerUp({ choice: 'a', probabilities: { a: 1, b: 0 } }), null);
});
