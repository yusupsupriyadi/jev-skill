import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTurnStart, readTail, summarizeTurn } from '../scripts/lib/transcript.mjs';

const TURN_ONE = 'p-one';
const TURN_TWO = 'p-two';

function userPrompt(promptId, text) {
  return { type: 'user', promptId, isSidechain: false, message: { role: 'user', content: text } };
}

function assistantTools(blocks) {
  // Real assistant entries carry no promptId; they belong to the turn by position.
  return { type: 'assistant', isSidechain: false, message: { role: 'assistant', content: blocks } };
}

function toolResult(promptId, id, isError) {
  const block = { type: 'tool_result', tool_use_id: id, content: 'out' };
  if (isError) block.is_error = true;
  return { type: 'user', promptId, isSidechain: false, message: { role: 'user', content: [block] } };
}

function writeTranscript(entries) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-tr-')), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const FIXTURE = [
  userPrompt(TURN_ONE, 'first request'),
  assistantTools([{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'old.ts' } }]),
  toolResult(TURN_ONE, 't1', false),
  { type: 'cost-state', sessionId: 's' },
  userPrompt(TURN_TWO, 'second request'),
  assistantTools([
    { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'src/new.ts' } },
    { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } },
  ]),
  toolResult(TURN_TWO, 't2', false),
  toolResult(TURN_TWO, 't3', true),
  assistantTools([
    { type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'git status' } },
  ]),
  toolResult(TURN_TWO, 't4', false),
  { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', id: 's1', name: 'Edit', input: { file_path: 'subagent.ts' } }] } },
  assistantTools([{ type: 'text', text: 'All done, the feature works.' }]),
];

test('a turn is sliced from its user entry even though assistant entries lack promptId', () => {
  const file = writeTranscript(FIXTURE);
  const summary = summarizeTurn({ transcriptPath: file, promptId: TURN_TWO });
  assert.deepEqual(summary.filesChanged, ['src/new.ts']);
  assert.equal(summary.commands.length, 2);
  assert.equal(summary.finalMessage, 'All done, the feature works.');
});

test('subagent entries are excluded', () => {
  const file = writeTranscript(FIXTURE);
  const summary = summarizeTurn({ transcriptPath: file, promptId: TURN_TWO });
  assert.equal(summary.filesChanged.includes('subagent.ts'), false);
});

test('a failed tool_result marks its command as failed', () => {
  const file = writeTranscript(FIXTURE);
  const summary = summarizeTurn({ transcriptPath: file, promptId: TURN_TWO });
  const npm = summary.commands.find((c) => c.command === 'npm test');
  assert.equal(npm.failed, true);
  assert.equal(summary.verificationCommands.length, 1);
  assert.equal(summary.failedCommands.length, 1);
});

test('an unknown promptId falls back to the last real user prompt', () => {
  const file = writeTranscript(FIXTURE);
  const summary = summarizeTurn({ transcriptPath: file, promptId: 'not-in-file' });
  assert.deepEqual(summary.filesChanged, ['src/new.ts']);
});

test('a turn with no tools reports nothing to judge', () => {
  const file = writeTranscript([userPrompt(TURN_ONE, 'hi'), assistantTools([{ type: 'text', text: 'hello' }])]);
  const summary = summarizeTurn({ transcriptPath: file, promptId: TURN_ONE });
  assert.equal(summary.touched, false);
});

test('a missing transcript yields an empty summary rather than throwing', () => {
  const summary = summarizeTurn({ transcriptPath: path.join(os.tmpdir(), 'jev-nope.jsonl'), promptId: 'x' });
  assert.equal(summary.touched, false);
});

test('readTail drops the partial first line when it truncates', () => {
  const file = writeTranscript(FIXTURE);
  const full = readTail(file, 10 * 1024 * 1024);
  const clipped = readTail(file, 300);
  assert.ok(clipped.length < full.length);
  for (const line of clipped.filter(Boolean)) JSON.parse(line);
});

test('findTurnStart returns -1 when there is no user entry', () => {
  assert.equal(findTurnStart([{ type: 'assistant' }], 'x'), -1);
});
