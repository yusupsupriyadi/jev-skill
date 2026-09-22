import fs from 'node:fs';
import path from 'node:path';

export function readStdin(maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve({});
      return;
    }
    let raw = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        raw = raw.slice(0, maxBytes);
        process.stdin.pause();
        finish();
      }
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

export function makeLogger(config) {
  const logFile = path.join(config.dataDir, 'jev.log');
  return (...parts) => {
    if (!config.debug) return;
    const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
    // stderr never reaches Claude's context; stdout would.
    process.stderr.write(line);
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.appendFileSync(logFile, line);
    } catch {
      /* logging must never break a hook */
    }
  };
}

/** Nothing else may reach stdout: on UserPromptSubmit and SessionStart it becomes Claude context. */
export function emit(payload) {
  if (!payload) return;
  // A synchronous write guarantees the bytes land even if the process exits right after.
  try {
    fs.writeSync(1, `${JSON.stringify(payload)}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}

export function promptSubmitContext(text) {
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: text,
    },
  };
}

export function sessionStartContext(text) {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: text,
    },
  };
}

/**
 * Fail-open: any failure exits 0 with no output.
 * A bare process.exit() here aborts on Windows with a libuv assertion while fetch closes a socket.
 */
export async function runHook(name, body) {
  try {
    await body();
  } catch (error) {
    if (process.env.JEV_DEBUG) {
      process.stderr.write(`[jev:${name}] ${error && error.stack ? error.stack : String(error)}\n`);
    }
  }
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 250).unref();
}

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJsonFile(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
    return true;
  } catch {
    return false;
  }
}
