---
name: jev-ask
description: Ask TypeSafe Jev typed questions and get calibrated probabilities back instead of prose - a yes/no, a pick from a fixed list, or a score on a rubric. Use it to classify, triage, route, rank, gate, or label text, especially across a batch of items (tickets, messages, reviews, log lines, records) where the same judgement has to be made the same way every time and a number you can threshold beats an opinion. Also use it whenever the user mentions Jev or TypeSafe, or asks for a confidence or probability. Not for anything that needs text written back.
argument-hint: [what to decide]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *), Write
---

# Ask Jev: $ARGUMENTS

Jev is a System One model. It writes no text. It reads a `state` and answers typed questions
about it with calibrated probabilities, in roughly 70 to 500 ms per call. It is worth reaching
for when a number you can act on beats your own read, and when one judgement has to be applied
to many items consistently.

## Three question types

| Type | Ask it when | You get back |
|---|---|---|
| `noul` | The answer is yes or no | `{"type":"noul","noul":0.96}`, the probability of yes |
| `choice` | One option out of a fixed list, up to 255 | `{"type":"choice","choice":"billing","probabilities":{...},"confidence":0.8}` |
| `score` | A position on an ordered rubric | `{"type":"score","score":1.06,"probabilities":{"0":0.0,"1":0.94,"2":0.06},"confidence":0.91,"legend":{...}}` |

A `score` is the probability-weighted level number, counting from 0. With three levels, 1.06
sits on the second one. Round it to read the level, and use `legend` to name that level.

## How to run one

1. Write `state.json` and `questions.json` into your scratchpad directory.
2. Run the CLI with the **absolute** path of each file after the `@`:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" decide --state @/abs/path/state.json --questions @/abs/path/questions.json
   ```

   The CLI resolves a relative path against the current directory, so `@state.json` fails
   unless the files happen to sit there.
3. Read `answers`. Each answer comes back under the name you gave its question.

`state.json` holds only the context the questions need:

```json
{ "message": "My payouts have been failing for 3 days.", "customer": { "plan": "pro" } }
```

`questions.json` holds every question, all evaluated in parallel against that one state:

```json
{
  "is_urgent": {
    "type": "noul",
    "instructions": { "question": "Does this convey urgency?", "inspect": "message" },
    "criteria": {
      "true": { "what": "Explicitly time-sensitive", "examples": ["down for 3 days", "blocking launch"] },
      "false": { "what": "No urgency expressed", "examples": ["just wondering", "when you get a chance"] }
    }
  },
  "team": {
    "type": "choice",
    "instructions": "Which team should handle this?",
    "criteria": {
      "billing": { "what": "Payments, invoices, refunds, payouts", "not_for": "Bugs or outages" },
      "technical": { "what": "Bugs, outages, API errors", "not_for": "Money questions" },
      "other": "Nothing above fits"
    }
  },
  "severity": {
    "type": "score",
    "instructions": "How severe is this?",
    "criteria": ["Cosmetic, nothing broken", "Degraded but a workaround exists", "Core functionality down"]
  }
}
```

## Many items: one state, one question per item

When the same questions apply to a batch, put every item into one state under a short key, and
ask each question once per item, pointing at that item with `instructions.inspect`:

```json
{ "tickets": { "t01": "I was charged twice for March.", "t02": "The API returns 500 on every POST." } }
```

```json
{
  "t01_team": {
    "type": "choice",
    "instructions": { "question": "Which team should handle this ticket?", "inspect": "tickets.t01", "focus": "Judge only this ticket." },
    "criteria": { "billing": "...", "technical": "...", "other": "Nothing above fits" }
  },
  "t02_team": {
    "type": "choice",
    "instructions": { "question": "Which team should handle this ticket?", "inspect": "tickets.t02", "focus": "Judge only this ticket." },
    "criteria": { "billing": "...", "technical": "...", "other": "Nothing above fits" }
  }
}
```

Jev scores each question on its own, so the answers match what separate calls would return, but
the batch costs one round trip and one command. On ten support tickets this gave the same team
for all ten as ten single calls did, urgency within 0.13, in 1.4 s instead of 7.7 s, for about a
third less.

The limit is a request budget of about 32,000 tokens, shared by the state and the questions,
which is roughly 150,000 characters of English. Past that, split the batch into several calls of
the same shape. For items that are long documents, one call per document is the safer default.

## Rules that decide whether the answer is any good

- **One question, one property.** Break a broad judgement into atomic questions and combine the answers yourself. Do not ask "is this good code".
- **Contrastive criteria.** Describe every option in the same shape so they can be told apart. `what`, `not_for`, and `examples` work well. They are conventions Jev reads, not a fixed schema, so a plain string is fine for an obvious option.
- **Both sides of a `noul`, or neither.** `criteria` is optional for a `noul`, but one given with only `true` or only `false` is rejected.
- **Always offer an escape.** Add `none` or `other` to a `choice` whenever the input might fall outside the list. Give the full list rather than a shortlist: each option costs only a few tokens.
- **Point at what matters.** `instructions.inspect` names the field to read, and `instructions.compare` takes a list of fields to check against each other.
- **Send only what the questions need.** Everything in `state` counts toward the budget and gives Jev more to be distracted by.

## Reading the answer

`choice` and `score` carry `confidence`, taken from the shape of the distribution: one peak is
high, a spread is low. `noul` carries none, so read the probability itself. These bands are a
starting point, taken from TypeSafe's own examples. Tune them once you have data of your own.

| Reading | Treat it as |
|---|---|
| `confidence` of 0.5 or less | Unsure. Do not act on it; decide yourself or ask |
| `noul` of 0.7 or more / 0.3 or less | Yes / no |
| `noul` between 0.3 and 0.7 | Unclear |
| Anything that deletes, pays, or cannot be undone | Require 0.9 |

When you report back, give the number and the band it falls in, and never present a probability
as a certainty. For a batch, list the unclear items apart from the rest so the user knows which
ones to check by hand.

## When the call fails

- `No API key`: jev is not connected. Tell the user to run `/jev:setup`.
- A `choice`, `score`, or `noul` rejected before sending: the CLI checks shape first. Fix the question it names.
- `Invalid request` with a detail from the server: fix the field the detail names, then run again.
- `Payload too large`: split the batch.
- `Payment required`: the account has no credit. Neither provider has a free tier.
- A timeout: the CLI waits 10 s. Retry once, then report it.

## Running the CLI on another agent

Claude Code fills in `${CLAUDE_PLUGIN_ROOT}`. On any other agent, run
`node "$JEV_HOME/scripts/cli.mjs"` instead, with `JEV_HOME` pointing at a clone of
https://github.com/yusupsupriyadi/jev-skill. `npx skills add` copies the skill folders but not
the `scripts/` directory the CLI lives in.
