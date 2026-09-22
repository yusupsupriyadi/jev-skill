import fs from 'node:fs';
import path from 'node:path';
import { discoverCatalog } from '../lib/catalog.mjs';
import { decide } from '../lib/jev-client.mjs';
import { chunkEntries, dedupeById, finalQuestion, pickQuestion, triageQuestions, NONE } from '../lib/questions.mjs';
import { formatJudgmentRecall, formatRouteContext, formatRunnerUp, sizeLabel } from '../lib/format.mjs';
import { readJsonFile } from '../lib/hook-io.mjs';

const MIN_PROMPT_LENGTH = 12;
const ACK_PATTERN = /^(ok(e|ay)?|ya|yes|yep|no|nope|lanjut|lanjutkan|next|thanks|thank you|terima kasih|makasih|sip|mantap|good|nice|siap|done|go ahead|proceed)\b[\s.!,]*$/i;
const JUDGMENT_MAX_AGE_MS = 30 * 60 * 1000;
const CANDIDATE_MIN_PROBABILITY = 0.15;
const MAX_FINALISTS = 12;

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

/**
 * Takes each chunk's strongest real option, even when "none" won that chunk. Inside 200
 * options "none" competes against every one of them, so a good candidate loses on spread
 * alone; the run-off is where "none" gets a fair comparison against a short list.
 */
function candidatesFrom(results) {
  const candidates = [];
  for (const result of results) {
    if (!result || !result.answers || !result.answers.pick) continue;
    const probabilities = result.answers.pick.probabilities;
    if (!probabilities) continue;
    const best = Object.entries(probabilities)
      .filter(([option]) => option !== NONE)
      .sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < CANDIDATE_MIN_PROBABILITY) continue;
    candidates.push({ id: best[0], probability: best[1] });
  }
  return candidates.sort((a, b) => b.probability - a.probability);
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

  const candidates = candidatesFrom(skillResults);
  if (candidates.length === 0) {
    log('no candidate cleared the prefilter');
    return null;
  }

  const finalists = candidates.slice(0, MAX_FINALISTS).map((c) => byId.get(c.id)).filter(Boolean);
  if (finalists.length === 0) {
    log('candidates missing from catalog');
    return null;
  }

  const runOff = await decide({ ...common, questions: finalQuestion(finalists, { kind: 'skill' }) })
    .catch((error) => {
      log('runoff failed', error.message);
      return null;
    });
  const answer = runOff && runOff.answers ? runOff.answers.pick : null;
  if (!answer || !answer.choice) {
    log('runoff returned nothing');
    return null;
  }
  if (answer.choice === NONE) {
    log('runoff chose none');
    return null;
  }

  // Gate on whether any skill fits, not on which one won. Two equally good skills split
  // the mass and drag `confidence` down while "none" sits at zero, and suppressing the
  // suggestion there would be the wrong reading of a distribution that is sure of itself.
  const probabilities = answer.probabilities || {};
  const relevance = 1 - (probabilities[NONE] || 0);
  if (relevance < config.routeMinConfidence) {
    log('nothing fits', { relevance });
    return null;
  }

  const chosen = {
    id: answer.choice,
    probability: probabilities[answer.choice] || 0,
    relevance,
  };

  const agentBest = bestOf(agentResults);
  const sizeAnswer = triage && triage.answers ? triage.answers.size : null;
  const entry = byId.get(chosen.id);

  return {
    pick: chosen.id,
    confidence: chosen.probability,
    relevance: chosen.relevance,
    runnerUp: formatRunnerUp(answer),
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
    relevance: result.relevance,
    runnerUp: result.runnerUp,
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
