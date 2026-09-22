import fs from 'node:fs';
import path from 'node:path';
import { discoverCatalog } from '../lib/catalog.mjs';
import { decide } from '../lib/jev-client.mjs';
import { chunkEntries, dedupeById, finalQuestion, pickQuestion, triageQuestions, NONE } from '../lib/questions.mjs';
import { formatJudgmentRecall, formatRouteContext, sizeLabel } from '../lib/format.mjs';
import { readJsonFile } from '../lib/hook-io.mjs';

const MIN_PROMPT_LENGTH = 12;
const ACK_PATTERN = /^(ok(e|ay)?|ya|yes|yep|no|nope|lanjut|lanjutkan|next|thanks|thank you|terima kasih|makasih|sip|mantap|good|nice|siap|done|go ahead|proceed)\b[\s.!,]*$/i;
const JUDGMENT_MAX_AGE_MS = 30 * 60 * 1000;

/** Prompts that are not a fresh unit of work, cheap to detect without a round trip. */
export function shouldSkipPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return true;
  if (text.startsWith('/')) return true; // the user already chose a skill
  if (text.length < MIN_PROMPT_LENGTH) return true;
  if (ACK_PATTERN.test(text)) return true;
  return false;
}

function projectHint(cwd) {
  const hint = { cwd: path.basename(cwd) };
  try {
    hint.git_repo = fs.existsSync(path.join(cwd, '.git'));
  } catch {
    hint.git_repo = false;
  }
  const languages = new Set();
  const markers = [
    ['package.json', 'javascript/typescript'],
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'python'],
    ['go.mod', 'go'],
    ['Cargo.toml', 'rust'],
    ['pubspec.yaml', 'dart/flutter'],
    ['composer.json', 'php'],
    ['pom.xml', 'java'],
    ['build.gradle.kts', 'kotlin'],
    ['Gemfile', 'ruby'],
  ];
  for (const [file, language] of markers) {
    try {
      if (fs.existsSync(path.join(cwd, file))) languages.add(language);
    } catch {
      /* unreadable project root */
    }
  }
  if (languages.size > 0) hint.languages = [...languages];
  return hint;
}

function bestOf(results) {
  let best = null;
  for (const result of results) {
    if (!result || !result.answers || !result.answers.pick) continue;
    const answer = result.answers.pick;
    if (!answer.choice || answer.choice === NONE) continue;
    const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0;
    if (!best || confidence > best.confidence) best = { choice: answer.choice, confidence };
  }
  return best;
}

function winnersOf(results) {
  const winners = [];
  for (const result of results) {
    if (!result || !result.answers || !result.answers.pick) continue;
    const answer = result.answers.pick;
    if (!answer.choice || answer.choice === NONE) continue;
    const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0;
    if (confidence < 0.3) continue;
    winners.push({ id: answer.choice, confidence });
  }
  return winners;
}

async function askChunks(chunks, kind, common) {
  const settled = await Promise.allSettled(chunks.map((chunk) => decide({
    ...common,
    questions: pickQuestion(chunk, { kind }),
  })));
  return settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
}

/** Chunks vote in parallel and the winners run off, because one choice caps at 255 options. */
export async function route({ prompt, config, log = () => {}, sessionId = null }) {
  const catalog = discoverCatalog({
    configDir: config.configDir,
    cwd: config.cwd,
    includeAgents: config.includeAgents,
    routeExclude: config.routeExclude,
    extraPluginDirs: config.extraPluginDirs,
  });
  if (catalog.length === 0) {
    log('catalog empty');
    return null;
  }

  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const skills = dedupeById(catalog.filter((entry) => entry.kind !== 'agent'));
  const agents = dedupeById(catalog.filter((entry) => entry.kind === 'agent'));
  const state = { prompt: String(prompt), project: projectHint(config.cwd) };
  const common = {
    state,
    model: config.model,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    timeoutMs: config.timeoutMs,
    sessionId,
  };

  const skillChunks = chunkEntries(skills);
  const agentChunks = config.includeAgents && agents.length > 0 ? chunkEntries(agents) : [];
  log('routing', { skills: skills.length, agents: agents.length, chunks: skillChunks.length + agentChunks.length });

  const [triage, skillResults, agentResults] = await Promise.all([
    decide({ ...common, questions: triageQuestions() }).catch((error) => {
      log('triage failed', error.message);
      return null;
    }),
    askChunks(skillChunks, 'skill', common),
    agentChunks.length > 0 ? askChunks(agentChunks, 'agent', common) : Promise.resolve([]),
  ]);

  const isTask = triage && triage.answers && triage.answers.is_task ? triage.answers.is_task.noul : 1;
  if (typeof isTask === 'number' && isTask < 0.5) {
    log('not a task', isTask);
    return null;
  }

  const winners = winnersOf(skillResults);
  if (winners.length === 0) {
    log('no skill winner');
    return null;
  }

  let chosen;
  if (winners.length === 1) {
    chosen = winners[0];
  } else {
    const finalists = winners.map((w) => byId.get(w.id)).filter(Boolean);
    const runOff = await decide({ ...common, questions: finalQuestion(finalists, { kind: 'skill' }) })
      .catch((error) => {
        log('runoff failed', error.message);
        return null;
      });
    const answer = runOff && runOff.answers ? runOff.answers.pick : null;
    if (answer && answer.choice && answer.choice !== NONE) {
      chosen = { id: answer.choice, confidence: typeof answer.confidence === 'number' ? answer.confidence : 0 };
    } else if (answer && answer.choice === NONE) {
      log('runoff chose none');
      return null;
    } else {
      chosen = [...winners].sort((a, b) => b.confidence - a.confidence)[0];
    }
  }

  if (!chosen || chosen.confidence < config.routeMinConfidence) {
    log('below confidence floor', chosen);
    return null;
  }

  const agentBest = bestOf(agentResults);
  const sizeAnswer = triage && triage.answers ? triage.answers.size : null;
  const entry = byId.get(chosen.id);

  return {
    pick: chosen.id,
    confidence: chosen.confidence,
    description: entry ? entry.description : '',
    agent: agentBest && agentBest.confidence >= config.routeMinConfidence ? agentBest.choice : null,
    agentConfidence: agentBest ? agentBest.confidence : 0,
    size: sizeLabel(sizeAnswer),
    sizeConfidence: sizeAnswer && typeof sizeAnswer.confidence === 'number' ? sizeAnswer.confidence : 0,
    catalogSize: catalog.length,
  };
}

export function renderRoute(result) {
  if (!result) return null;
  return formatRouteContext({
    pick: result.pick,
    description: result.description,
    confidence: result.confidence,
    agent: result.agent,
    agentConfidence: result.agentConfidence,
    size: result.size,
    sizeConfidence: result.sizeConfidence,
  });
}

/**
 * The Stop hook cannot inject context, so a judgment is parked on disk and replayed
 * here, at the top of the next prompt, then discarded.
 */
export function consumeJudgment(config, sessionId) {
  const file = path.join(config.dataDir, 'last-judgment.json');
  const judgment = readJsonFile(file);
  if (!judgment) return null;
  try {
    fs.unlinkSync(file);
  } catch {
    /* a stale file is harmless; the age check below covers it */
  }
  if (sessionId && judgment.session_id && judgment.session_id !== sessionId) return null;
  const age = Date.now() - Date.parse(judgment.created_at || '');
  if (!Number.isFinite(age) || age > JUDGMENT_MAX_AGE_MS) return null;
  return formatJudgmentRecall(judgment);
}
