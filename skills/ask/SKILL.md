---
name: jev-ask
description: Ask TypeSafe Jev a typed question and get calibrated probabilities back instead of prose. Use for a fast yes/no, a pick from a fixed list, or a score on a rubric - classifying, routing, triaging, ranking, gating, or extracting from text - especially over many items at once.
argument-hint: [what to decide]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *), Write
---

# Ask Jev: $ARGUMENTS

Jev is a System One model. It does not write text. It reads a `state` and answers typed
questions about it with calibrated probabilities, in roughly 70 to 500 ms per call.

## Three question types

| Type | Ask it when | You get back |
|---|---|---|
| `noul` | The answer is yes or no | `{"type":"noul","noul":0.96}` - the probability of yes |
| `choice` | One option out of a fixed list, up to 255 | `{"type":"choice","choice":"billing","probabilities":{...},"confidence":0.8}` |
| `score` | A position on an ordered rubric | `{"type":"score","score":1.99,"probabilities":{...},"confidence":0.99,"legend":{...}}` |

## How to run one

1. Write the payload to two files in your scratchpad directory, `state.json` and `questions.json`.
2. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" decide --state @state.json --questions @questions.json`
3. Read the `answers` object and act on it in your own reasoning.

`state.json` holds only the context these questions need:

```json
{ "message": "My payouts have been failing for 3 days.", "customer": { "plan": "pro" } }
```

`questions.json` holds every question, all evaluated in parallel against that one state:

```json
{
  "is_urgent": {
    "type": "noul",
    "instructions": { "question": "Does this convey urgency?", "focus": "Read `message`." },
    "criteria": {
      "true": { "what": "Explicitly time-sensitive", "examples": ["down for 3 days", "blocking launch"] },
      "false": { "what": "No urgency expressed", "examples": ["just wondering", "when you get a chance"] }
    }
  },
  "team": {
    "type": "choice",
    "instructions": "Which team should handle this?",
    "criteria": {
      "billing": "Payments, invoices, refunds, payouts",
      "technical": "Bugs, outages, API errors",
      "none": "Nothing above fits"
    }
  },
  "severity": {
    "type": "score",
    "instructions": "How severe is this?",
    "criteria": ["Cosmetic, nothing broken", "Degraded but a workaround exists", "Core functionality down"]
  }
}
```

## Rules that decide whether the answer is any good

- **One question, one property.** Break a broad judgement into atomic questions and combine them yourself. Do not ask "is this good code".
- **Contrastive criteria.** Describe every option with the same shape, so they can be compared. `what`, `not_for`, and `examples` work well.
- **A `noul` needs both sides.** Supply `criteria.true` and `criteria.false`, or the request is rejected.
- **Always offer an escape.** Add `none` or `other` to a `choice` whenever the input might fall outside the list.
- **Batch instead of looping.** Twenty questions over one state cost one round trip. Twenty separate calls cost twenty.

## Reading confidence

`confidence` comes from the shape of the distribution: a single peak is high, a flat spread is low.
`noul` carries no confidence, so read the probability itself. Act on high confidence, confirm on
middling confidence, and escalate to your own reasoning when it is low. Say which band you are in
when you report back, and never present a probability as a certainty.

## Running the CLI on another agent

The commands above locate the jev CLI through `${CLAUDE_PLUGIN_ROOT}`, which Claude Code sets. On any
other agent, set `JEV_HOME` to this plugin directory and run `node "$JEV_HOME/scripts/cli.mjs"` instead.
