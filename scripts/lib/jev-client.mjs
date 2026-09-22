export const MAX_CHOICE_OPTIONS = 255;

export class JevError extends Error {
  constructor(message, { status = null, code = null, cause = null } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

// Wording stays provider-neutral: the same client talks to TypeSafe and to OpenRouter.
const STATUS_HINTS = {
  400: 'Invalid request. A question is malformed.',
  401: 'The API key was rejected.',
  402: 'Payment required. Jev has no free tier, so the account needs credit.',
  403: 'The key is not permitted to call this model.',
  404: 'Model or endpoint not found. Check the model slug and the endpoint URL.',
  413: 'Payload too large. Send less state, or turn off send_diff.',
  429: 'Rate limited.',
  500: 'Server error from the provider.',
  502: 'Upstream provider error.',
  503: 'Service unavailable.',
  524: 'Request timed out upstream.',
  529: 'Provider overloaded.',
};

/**
 * Validates a questions map against the constraints the Decisions API enforces.
 * Throws JevError so a caller can fail fast before spending a round trip.
 */
export function validateQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new JevError('questions must be an object keyed by question name');
  }
  const names = Object.keys(questions);
  if (names.length === 0) throw new JevError('questions must contain at least one question');

  for (const name of names) {
    const question = questions[name];
    if (!question || typeof question !== 'object') {
      throw new JevError(`question "${name}" must be an object`);
    }
    const { type, criteria } = question;
    if (type === 'noul') {
      // OpenRouter rejects a noul whose criteria omits either side.
      if (criteria !== undefined && criteria !== null) {
        if (typeof criteria !== 'object' || Array.isArray(criteria)) {
          throw new JevError(`noul question "${name}" needs an object criteria with true and false`);
        }
        if (!('true' in criteria) || !('false' in criteria)) {
          throw new JevError(`noul question "${name}" needs both criteria.true and criteria.false`);
        }
      }
    } else if (type === 'choice') {
      if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
        throw new JevError(`choice question "${name}" needs an object criteria of option -> description`);
      }
      const optionCount = Object.keys(criteria).length;
      if (optionCount < 2) throw new JevError(`choice question "${name}" needs at least 2 options`);
      if (optionCount > MAX_CHOICE_OPTIONS) {
        throw new JevError(`choice question "${name}" has ${optionCount} options, over the ${MAX_CHOICE_OPTIONS} limit`);
      }
    } else if (type === 'score') {
      if (!Array.isArray(criteria) || criteria.length < 2) {
        throw new JevError(`score question "${name}" needs a criteria array with at least 2 levels`);
      }
    } else {
      throw new JevError(`question "${name}" has unknown type "${type}" (expected noul, choice, or score)`);
    }
  }
  return questions;
}

/**
 * Calls the OpenRouter Decisions API. Resolves with {id, model, provider, answers, usage}.
 */
export async function decide({
  state,
  questions,
  model,
  apiKey,
  apiUrl,
  timeoutMs = 2500,
  sessionId = null,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new JevError('No OpenRouter API key', { code: 'NO_KEY' });
  validateQuestions(questions);

  const body = { model, state, questions };
  if (sessionId) body.session_id = String(sessionId).slice(0, 256);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/yusupsupriyadi/jev-skill',
        'X-Title': 'jev for Claude Code',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new JevError(`Jev call timed out after ${timeoutMs}ms`, { code: 'TIMEOUT', cause: error });
    }
    throw new JevError(`Jev call failed: ${error && error.message ? error.message : String(error)}`, {
      code: 'NETWORK',
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      detail = text ? ` ${text.slice(0, 400)}` : '';
    } catch {
      /* body is optional */
    }
    const hint = STATUS_HINTS[response.status] || `HTTP ${response.status}`;
    throw new JevError(`${hint}${detail}`, { status: response.status, code: `HTTP_${response.status}` });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new JevError('Jev returned a body that is not JSON', { code: 'BAD_JSON', cause: error });
  }
  if (!payload || typeof payload !== 'object' || !payload.answers) {
    throw new JevError('Jev response has no answers field', { code: 'NO_ANSWERS' });
  }
  return payload;
}

/** Confidence for a choice/score answer; noul answers carry none, so derive one from distance to 0.5. */
export function confidenceOf(answer) {
  if (!answer) return 0;
  if (typeof answer.confidence === 'number') return answer.confidence;
  if (typeof answer.noul === 'number') return Math.abs(answer.noul - 0.5) * 2;
  return 0;
}

/** Second-highest option of a choice answer, for showing a runner-up. */
export function runnerUp(answer) {
  if (!answer || !answer.probabilities) return null;
  const sorted = Object.entries(answer.probabilities)
    .filter(([key]) => key !== answer.choice)
    .sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || sorted[0][1] <= 0) return null;
  return { option: sorted[0][0], probability: sorted[0][1] };
}
