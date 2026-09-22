import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));

/** Stands in for the Decisions API so the whole hook path can run offline. */
function startServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        requests.push(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(handler(parsed)));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, requests, url: 'http://127.0.0.1:' + server.address().port + '/api/alpha/decisions' });
    });
  });
}

/**
 * Runs the hook as a child process. It must not be spawnSync: the mock server lives in
 * this process, and a synchronous spawn would block the event loop that has to answer it.
 */
function runHook(args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

function fixtureConfigDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-e2e-'));
  const configDir = path.join(root, '.claude');
  const plugin = path.join(configDir, 'plugins', 'cache', 'demo');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo' }));
  for (const [name, description] of [['debug', 'Finds and fixes bugs'], ['write-docs', 'Writes documentation']]) {
    fs.mkdirSync(path.join(plugin, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(plugin, 'skills', name, 'SKILL.md'), '---\ndescription: ' + description + '\n---\nbody\n');
  }
  fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'demo@mp': true } }));
  fs.writeFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@mp': [{ scope: 'user', installPath: plugin }] },
  }));
  return { root, configDir, dataDir: path.join(root, 'data') };
}

test('the route hook emits only UserPromptSubmit JSON carrying the suggestion', async () => {
  const { configDir, dataDir } = fixtureConfigDir();
  const { server, requests, url } = await startServer((body) => {
    if (body.questions.is_task) {
      return {
        answers: {
          is_task: { type: 'noul', noul: 0.97 },
          size: { type: 'score', score: 1.1, confidence: 0.8, probabilities: {} },
        },
      };
    }
    return {
      answers: {
        pick: {
          type: 'choice',
          choice: 'demo:debug',
          confidence: 0.91,
          probabilities: { 'demo:debug': 0.91, 'demo:write-docs': 0.09 },
        },
      },
    };
  });

  try {
    const result = await runHook(['hook', 'route'], {
      hook_event_name: 'UserPromptSubmit',
      user_prompt: 'tolong perbaiki bug login yang gagal di safari',
      session_id: 'sess-1',
    }, {
      OPENROUTER_API_KEY: 'sk-or-test',
      JEV_API_URL: url,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_DATA: dataDir,
      JEV_INCLUDE_AGENTS: 'false',
    });

    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(payload.hookSpecificOutput.additionalContext, /demo:debug \(confidence 0\.91\)/);
    assert.match(payload.hookSpecificOutput.additionalContext, /standard/);
    assert.ok(requests.some((r) => r.questions.is_task), 'triage ran');
    assert.ok(requests.some((r) => r.questions.pick), 'candidates ran');
  } finally {
    server.close();
  }
});

test('a prompt Jev calls conversational produces no output at all', async () => {
  const { configDir, dataDir } = fixtureConfigDir();
  const { server, url } = await startServer((body) => (body.questions.is_task
    ? { answers: { is_task: { type: 'noul', noul: 0.05 } } }
    : { answers: { pick: { type: 'choice', choice: 'demo:debug', confidence: 0.99, probabilities: {} } } }));

  try {
    const result = await runHook(['hook', 'route'], {
      hook_event_name: 'UserPromptSubmit',
      user_prompt: 'what did you just change in that file?',
      session_id: 'sess-2',
    }, {
      OPENROUTER_API_KEY: 'sk-or-test',
      JEV_API_URL: url,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_DATA: dataDir,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    server.close();
  }
});

test('a server error leaves the prompt untouched', async () => {
  const { configDir, dataDir } = fixtureConfigDir();
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"boom"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/alpha/decisions';

  try {
    const result = await runHook(['hook', 'route'], {
      hook_event_name: 'UserPromptSubmit',
      user_prompt: 'add a rate limiter to the public API',
      session_id: 'sess-3',
    }, {
      OPENROUTER_API_KEY: 'sk-or-test',
      JEV_API_URL: url,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_DATA: dataDir,
    });
    assert.equal(result.status, 0, 'hook still exits 0');
    assert.equal(result.stdout, '', 'nothing is injected');
  } finally {
    server.close();
  }
});

test('the Stop hook writes a judgment file and stays silent on stdout', async () => {
  const { configDir, dataDir, root } = fixtureConfigDir();
  const transcript = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', promptId: 'p-9', isSidechain: false, message: { role: 'user', content: 'do it' } }),
    JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'a1', name: 'Write', input: { file_path: 'src/x.ts' } }],
      },
    }),
  ].join('\n') + '\n');

  const { server, url } = await startServer(() => ({
    answers: {
      claims_done: { type: 'noul', noul: 0.95 },
      has_evidence: { type: 'noul', noul: 0.05 },
      needs_tests: { type: 'noul', noul: 0.8 },
      secrets: { type: 'noul', noul: 0.01 },
      risk: { type: 'score', score: 1.2, confidence: 0.7, probabilities: {} },
    },
    usage: { input_tokens: 10, output_tokens: 0, cost: 0.000001 },
  }));

  try {
    const env = {
      OPENROUTER_API_KEY: 'sk-or-test',
      JEV_API_URL: url,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PLUGIN_DATA: dataDir,
      CLAUDE_PROJECT_DIR: root,
    };
    const result = await runHook(['hook', 'judge'], {
      hook_event_name: 'Stop',
      prompt_id: 'p-9',
      session_id: 'sess-4',
      transcript_path: transcript,
      last_assistant_message: 'Done, the feature works.',
    }, env);

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '', 'Stop output is ignored by Claude Code, so emit nothing');

    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'last-judgment.json'), 'utf8'));
    const keys = saved.findings.map((f) => f.key);
    assert.deepEqual(keys, ['unverified_claim', 'needs_tests']);
    assert.equal(saved.prompt_id, 'p-9');
    assert.ok(Date.parse(saved.created_at) > 0);

    // The same prompt must not be judged, or charged for, twice.
    const again = await runHook(['hook', 'judge'], {
      hook_event_name: 'Stop',
      prompt_id: 'p-9',
      session_id: 'sess-4',
      transcript_path: transcript,
      last_assistant_message: 'Done.',
    }, env);
    assert.equal(again.status, 0);
    assert.equal(again.stdout, '');
  } finally {
    server.close();
  }
});
