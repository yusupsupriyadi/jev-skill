import { MAX_CHOICE_OPTIONS } from './jev-client.mjs';

export const NONE = 'none';
// Leaves headroom under the 255-option ceiling for the "none" escape hatch.
export const DEFAULT_CHUNK_OPTIONS = 200;
export const DEFAULT_CHUNK_CHARS = 40000;

/**
 * Two entries can share an id across kinds (a plugin may ship both a skill and a
 * command by the same name). Option keys are JSON keys, so collapse them first.
 */
export function dedupeById(entries) {
  const byId = new Map();
  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/** Packs entries into chunks that stay inside the option ceiling and the context window. */
export function chunkEntries(entries, { maxOptions = DEFAULT_CHUNK_OPTIONS, maxChars = DEFAULT_CHUNK_CHARS } = {}) {
  const limit = Math.min(maxOptions, MAX_CHOICE_OPTIONS - 1);
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const entry of sorted) {
    const cost = entry.id.length + entry.description.length + 8;
    if (current.length >= limit || (current.length > 0 && chars + cost > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(entry);
    chars += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function criteriaFrom(entries) {
  const criteria = {};
  for (const entry of entries) criteria[entry.id] = entry.description;
  criteria[NONE] = 'None of the options above is a good fit for this request.';
  return criteria;
}

/**
 * Decides whether the prompt is a fresh unit of work and how big it is.
 * Kept in its own cheap call so the gate survives a failing candidate chunk.
 */
export function triageQuestions() {
  return {
    is_task: {
      type: 'noul',
      instructions: {
        question: 'Is the user asking for a new piece of work to be carried out?',
        focus: 'Judge `prompt` on its own.',
      },
      criteria: {
        true: {
          what: 'A request to build, change, fix, review, plan, investigate, or explain something',
          examples: ['add a login form', 'perbaiki bug login di safari', 'why is this query slow?'],
        },
        false: {
          what: 'A short acknowledgement, confirmation, or aside that does not ask for new work',
          examples: ['ok', 'lanjut', 'thanks', 'yes, go ahead'],
        },
      },
    },
    size: {
      type: 'score',
      instructions: {
        question: 'How much work does this request involve?',
        focus: 'Judge the scope implied by `prompt`, not how hard it is to explain.',
      },
      criteria: [
        'Quick: documentation, copy, formatting, a config tweak, styling, or a small single-file change',
        'Standard: a bug fix, a feature spanning a few files, a limited refactor, or a behaviour change',
        'Major: an architecture change, a migration, security-sensitive work, a deployment, a large refactor, or a complex integration',
      ],
    },
  };
}

/** One chunk of routing candidates, asked as a single choice. */
export function pickQuestion(entries, { kind = 'skill' } = {}) {
  const subject = kind === 'agent' ? 'specialised subagents' : 'Claude Code skills and slash commands';
  return {
    pick: {
      type: 'choice',
      instructions: {
        question: 'Which of these ' + subject + ' best fits the user request?',
        focus: 'Compare what the user asks for in `prompt` against what each option is for. Choose "'
          + NONE + '" unless an option clearly fits.',
      },
      criteria: criteriaFrom(entries),
    },
  };
}

/** Runs off the winners of each chunk to produce one answer. */
export function finalQuestion(entries, { kind = 'skill' } = {}) {
  const subject = kind === 'agent' ? 'subagents' : 'skills';
  return {
    pick: {
      type: 'choice',
      instructions: {
        question: 'Which single one of these ' + subject + ' should be used for the user request?',
        focus: 'These are the strongest candidates from a wider list. Choose "'
          + NONE + '" if none of them genuinely fits `prompt`.',
      },
      criteria: criteriaFrom(entries),
    },
  };
}

/**
 * Post-turn judgment. Every question is deliberately narrow so the caller can act on
 * each one independently rather than unpacking one broad verdict.
 */
export function judgeQuestions({ reviewers = [] } = {}) {
  const questions = {
    claims_done: {
      type: 'noul',
      instructions: {
        question: 'Does the assistant say the work is finished, fixed, passing, or working?',
        focus: 'Read `final_message` only.',
      },
      criteria: {
        true: {
          what: 'States or strongly implies the task is complete, the bug is fixed, or the change works',
          examples: ['Done, the login bug is fixed.', 'All tests pass now.', 'The feature works as requested.'],
        },
        false: {
          what: 'Reports progress, asks a question, describes findings, or flags something as unverified',
          examples: ['I changed the handler; tests still need to run.', 'Which approach do you prefer?'],
        },
      },
    },
    has_evidence: {
      type: 'noul',
      instructions: {
        question: 'Did this turn actually run a check that verifies the change?',
        focus: 'Look at `commands_run` and `verification_commands`, not at what the assistant claims.',
      },
      criteria: {
        true: {
          what: 'A test suite, type check, linter, or build ran in this turn and succeeded',
          examples: ['npm test exited 0', 'pytest passed', 'tsc reported no errors'],
        },
        false: {
          what: 'No verification ran, only unrelated commands ran, or the verification failed',
          examples: ['only git status ran', 'files were edited and nothing was executed'],
        },
      },
    },
    needs_tests: {
      type: 'noul',
      instructions: {
        question: 'Should this change come with a new or updated automated test?',
        focus: 'Look at `files_changed` and `diff`.',
      },
      criteria: {
        true: {
          what: 'Behaviour, logic, or a bug fix changed in code a test could cover, and no test was added or updated',
          examples: ['a new function with branching logic', 'a bug fix in a parser with no test touched'],
        },
        false: {
          what: 'Documentation, comments, formatting, configuration, generated files, or a change whose test was already updated',
          examples: ['README edit', 'renamed a CSS class', 'the diff already includes a test file'],
        },
      },
    },
    secrets: {
      type: 'noul',
      instructions: {
        question: 'Does the change introduce a hardcoded credential?',
        focus: 'Look at `diff`.',
      },
      criteria: {
        true: {
          what: 'An API key, token, password, private key, or connection string with real-looking credentials is written into the code',
          examples: ['const key = "sk-live-9f3a..."', 'PASSWORD = "hunter2"'],
        },
        false: {
          what: 'No credential, or only placeholders, environment variable reads, and example values',
          examples: ['process.env.API_KEY', 'YOUR_KEY_HERE', 'sk-xxxxx in a comment'],
        },
      },
    },
    risk: {
      type: 'score',
      instructions: {
        question: 'How risky is this change if it is wrong?',
        focus: 'Weigh what `files_changed` and `diff` touch.',
      },
      criteria: [
        'Trivial: documentation, comments, formatting, or copy',
        'Low: isolated change to one component with an obvious blast radius',
        'Medium: shared logic, public interfaces, data handling, or something several callers depend on',
        'High: authentication, payments, migrations, deletion of data, deployment configuration, or security controls',
      ],
    },
  };

  if (reviewers.length >= 1) {
    questions.reviewer = {
      type: 'choice',
      instructions: {
        question: 'Which reviewer should look at this change?',
        focus: 'Match `files_changed` and `diff` against what each reviewer covers. Choose "'
          + NONE + '" if the change is too small or too plain to need one.',
      },
      criteria: criteriaFrom(reviewers),
    };
  }
  return questions;
}
