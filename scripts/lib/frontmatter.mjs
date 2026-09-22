const DELIMITER = /^---\s*$/;

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function coerce(value) {
  const lower = value.toLowerCase();
  if (['true', 'yes', 'on'].includes(lower)) return true;
  if (['false', 'no', 'off'].includes(lower)) return false;
  return value;
}

/**
 * Parses the YAML frontmatter of a SKILL.md / command / agent file.
 * Handles scalars, quoted scalars, and folded (>) or literal (|) blocks, which is
 * everything the skill and agent formats use for the fields this plugin reads.
 */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return {};
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  if (start >= lines.length || !DELIMITER.test(lines[start])) return {};

  const result = {};
  let key = null;
  let blockLines = null;
  let blockFolded = false;

  const flushBlock = () => {
    if (key && blockLines) {
      const joined = blockFolded ? blockLines.join(' ') : blockLines.join('\n');
      result[key] = joined.trim();
    }
    blockLines = null;
  };

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (DELIMITER.test(line)) {
      flushBlock();
      break;
    }
    if (blockLines) {
      if (line.trim() === '' || /^\s/.test(line)) {
        blockLines.push(line.trim());
        continue;
      }
      flushBlock();
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    key = match[1];
    const rawValue = match[2];
    if (rawValue === '>' || rawValue === '|' || rawValue === '>-' || rawValue === '|-') {
      blockFolded = rawValue.startsWith('>');
      blockLines = [];
      continue;
    }
    if (rawValue === '') {
      result[key] = '';
      continue;
    }
    result[key] = coerce(stripQuotes(rawValue));
  }
  flushBlock();
  return result;
}

export function isTruthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['true', 'yes', 'on', '1'].includes(value.trim().toLowerCase());
}
