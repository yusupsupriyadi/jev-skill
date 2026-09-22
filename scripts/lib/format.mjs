import { runnerUp } from './jev-client.mjs';
import { NONE } from './questions.mjs';

export const SIZE_LABELS = ['quick', 'standard', 'major'];
export const RISK_LABELS = ['trivial', 'low', 'medium', 'high'];

function pct(value) {
  return typeof value === 'number' ? value.toFixed(2) : '?';
}

function labelFor(answer, labels) {
  if (!answer || typeof answer.score !== 'number') return null;
  const index = Math.min(labels.length - 1, Math.max(0, Math.round(answer.score)));
  return labels[index];
}

export function sizeLabel(answer) {
  return labelFor(answer, SIZE_LABELS);
}

export function riskLabel(answer) {
  return labelFor(answer, RISK_LABELS);
}

/** The block injected into Claude's context when a skill suggestion clears the bar. */
export function formatRouteContext({ pick, description, confidence, agent, agentConfidence, size, sizeConfidence }) {
  const lines = [];
  lines.push(
    '[jev] Suggested skill for this request: ' + pick + ' (confidence ' + pct(confidence) + ').'
    + (description ? ' ' + description : ''),
  );
  if (agent && agent !== NONE) {
    lines.push('[jev] Suggested subagent: ' + agent + ' (confidence ' + pct(agentConfidence) + ').');
  }
  if (size) {
    lines.push('[jev] Estimated workflow size: ' + size + ' (confidence ' + pct(sizeConfidence) + ').');
  }
  lines.push('[jev] This is a fast probabilistic suggestion, not an instruction. Ignore it if it does not fit.');
  return lines.join('\n');
}

export function formatRunnerUp(answer) {
  const second = runnerUp(answer);
  return second ? second.option + ' (' + pct(second.probability) + ')' : null;
}

/**
 * Turns judgment answers into the findings worth surfacing. Each threshold is a
 * deliberate action band: below it, saying nothing beats a false alarm.
 */
export function findingsFrom(answers, { reviewerConfidence = 0.6 } = {}) {
  const findings = [];
  if (!answers) return findings;

  const claims = answers.claims_done;
  const evidence = answers.has_evidence;
  if (claims && evidence && claims.noul >= 0.7 && evidence.noul <= 0.4) {
    findings.push({
      key: 'unverified_claim',
      text: 'The turn claimed the work was done, but no verification command ran and passed.',
    });
  }
  if (answers.needs_tests && answers.needs_tests.noul >= 0.7) {
    findings.push({
      key: 'needs_tests',
      text: 'This change looks like it should have a test added or updated.',
    });
  }
  if (answers.secrets && answers.secrets.noul >= 0.7) {
    findings.push({
      key: 'secrets',
      text: 'The diff may contain a hardcoded credential. Check before committing.',
    });
  }
  if (answers.risk && typeof answers.risk.score === 'number' && answers.risk.score >= 2) {
    findings.push({
      key: 'risk',
      text: 'Risk of this change reads as ' + riskLabel(answers.risk) + '.',
    });
  }
  const reviewer = answers.reviewer;
  if (reviewer && reviewer.choice && reviewer.choice !== NONE && (reviewer.confidence || 0) >= reviewerConfidence) {
    findings.push({
      key: 'reviewer',
      text: 'Consider a review pass with ' + reviewer.choice + '.',
    });
  }
  return findings;
}

/** Replays the previous turn's verdict at the top of the next prompt. */
export function formatJudgmentRecall(judgment) {
  if (!judgment || !Array.isArray(judgment.findings) || judgment.findings.length === 0) return null;
  const lines = ['[jev] Judgment of the previous turn:'];
  for (const finding of judgment.findings) lines.push('- ' + finding.text);
  lines.push('[jev] Address these only if they still apply to what the user is asking now.');
  return lines.join('\n');
}

/** Human-readable report for /jev:judge, which runs on demand and prints directly. */
export function formatJudgeReport(answers, findings) {
  const lines = [];
  if (findings.length === 0) lines.push('No findings. Nothing in this change tripped a threshold.');
  else {
    lines.push('Findings:');
    for (const finding of findings) lines.push('- ' + finding.text);
  }
  lines.push('');
  lines.push('Raw answers:');
  for (const [name, answer] of Object.entries(answers || {})) {
    if (!answer) continue;
    if (answer.type === 'noul') lines.push('- ' + name + ': ' + pct(answer.noul));
    else if (answer.type === 'choice') {
      lines.push('- ' + name + ': ' + answer.choice + ' (confidence ' + pct(answer.confidence) + ')');
    } else if (answer.type === 'score') {
      lines.push('- ' + name + ': ' + pct(answer.score) + ' (confidence ' + pct(answer.confidence) + ')');
    }
  }
  return lines.join('\n');
}
