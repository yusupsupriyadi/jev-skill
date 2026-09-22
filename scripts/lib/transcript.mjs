import fs from 'node:fs';

export const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const VERIFICATION = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|build)\b|\b(pytest|vitest|jest|tsc|eslint|biome|ruff|mypy|phpunit|rspec)\b|\bcargo\s+(test|clippy|check)\b|\bgo\s+(test|vet)\b|\bdotnet\s+test\b|\bmvn\s+(test|verify)\b|\bgradle\w*\s+(test|check)\b|\bflutter\s+test\b|\bdart\s+analyze\b|\bnode\s+--test\b/i;

/**
 * Reads the last slice of a file. Transcripts reach tens of megabytes, so the whole
 * file is never loaded; the first line of the slice is dropped because it is partial.
 */
export function readTail(file, maxBytes = DEFAULT_TAIL_BYTES) {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const { size } = fs.fstatSync(handle);
    const length = Math.min(size, maxBytes);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines;
  } catch {
    return [];
  } finally {
    try {
      fs.closeSync(handle);
    } catch {
      /* already closed */
    }
  }
}

function parseLines(lines) {
  const entries = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    try {
      entries.push(JSON.parse(text));
    } catch {
      /* partial or non-JSON line */
    }
  }
  return entries;
}

/**
 * Finds where the current turn starts. Only user entries carry promptId; the assistant
 * entries that follow belong to the same turn by position, so an index is the boundary.
 */
export function findTurnStart(entries, promptId) {
  if (promptId) {
    const index = entries.findIndex((e) => e.type === 'user' && !e.isSidechain && e.promptId === promptId);
    if (index !== -1) return index;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type !== 'user' || entry.isSidechain) continue;
    const content = entry.message && entry.message.content;
    if (typeof content === 'string') return i;
  }
  return -1;
}

function contentBlocks(entry) {
  const content = entry && entry.message ? entry.message.content : null;
  return Array.isArray(content) ? content : [];
}

function textOf(block) {
  if (typeof block === 'string') return block;
  if (block && typeof block.text === 'string') return block.text;
  return '';
}

/**
 * Summarises what a turn actually did: which files it touched, which commands it ran
 * and whether they succeeded, and what the assistant said at the end.
 */
export function summarizeTurn({ transcriptPath, promptId, tailBytes = DEFAULT_TAIL_BYTES }) {
  const empty = {
    filesChanged: [],
    commands: [],
    verificationCommands: [],
    failedCommands: [],
    finalMessage: '',
    touched: false,
  };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return empty;

  const entries = parseLines(readTail(transcriptPath, tailBytes));
  const start = findTurnStart(entries, promptId);
  if (start === -1) return empty;

  const turn = entries.slice(start).filter((entry) => !entry.isSidechain);
  const files = new Set();
  const commands = [];
  const errorsById = new Map();
  let finalMessage = '';

  for (const entry of turn) {
    if (entry.type === 'assistant') {
      for (const block of contentBlocks(entry)) {
        if (block.type === 'text') finalMessage = textOf(block);
        if (block.type !== 'tool_use') continue;
        const input = block.input || {};
        if (EDIT_TOOLS.has(block.name)) {
          const file = input.file_path || input.notebook_path;
          if (file) files.add(String(file));
        } else if (SHELL_TOOLS.has(block.name) && input.command) {
          commands.push({ id: block.id, command: String(input.command).slice(0, 400) });
        }
      }
    } else if (entry.type === 'user') {
      for (const block of contentBlocks(entry)) {
        if (block.type === 'tool_result' && block.is_error) errorsById.set(block.tool_use_id, true);
      }
    }
  }

  const enriched = commands.map((item) => ({
    command: item.command,
    failed: errorsById.get(item.id) === true,
  }));

  return {
    filesChanged: [...files],
    commands: enriched,
    verificationCommands: enriched.filter((c) => VERIFICATION.test(c.command)),
    failedCommands: enriched.filter((c) => c.failed),
    finalMessage,
    touched: files.size > 0 || enriched.length > 0,
  };
}

export function isVerificationCommand(command) {
  return VERIFICATION.test(String(command || ''));
}
