# Calibrate jev routing against the live Decisions API

## Summary

Ran the plugin against the real OpenRouter Decisions API with a 537-entry catalog.
Six sample prompts exposed two failures that came from misreading the probability
distribution, not from broken plumbing. Fixed both; six of six now route correctly.

## Changes

- `scripts/hooks/route.mjs`: chunks contribute their strongest real option even when `none` wins locally; the run-off always runs and decides `none`; the gate uses `1 - P(none)` instead of the winner's confidence
- `scripts/lib/format.mjs`: output reports the winner's share, the relevance, and a runner-up separately
- `tests/format.test.mjs`, `tests/hook-integration.test.mjs`: assertions updated, runner-up regression added

## Decisions

- Inside a 200-option chunk, `none` competes against every option at once, so a relevant skill loses on spread alone. Chunks are a prefilter; the run-off is where `none` gets a fair comparison.
- A run-off `confidence` of 0.46 with `none` at 0.00 means two correct skills split the mass, not that nothing fits. Gating on relevance rather than confidence is the correct reading.

## Verification

- `npm test`: 54 passed, 0 failed
- Live routing, 6 of 6 correct: orch-fix-defect, tdd-workflow, security-review, vercel:deploy, commit-push-pr, frontend-patterns
- Live `doctor`: `~typesafe/jev-latest` resolves to `typesafe/jev-1.13-20260917`, 970 ms, $0.000013
- Live `judge` on this working tree: risk 1.94, needs_tests 0.27, secrets 0.02, reviewer ecc:code-reviewer 0.78, $0.000260
- Claude Code loaded the plugin and registered its hooks; the Stop hook ran and logged correctly

## Limitations

- `UserPromptSubmit` does not fire under `claude -p`, so the routing hook cannot be exercised from a non-interactive shell. It needs one interactive session to confirm end to end.
- Routing costs about $0.0004 per prompt at this catalog size; five parallel calls take 1.5 to 4 seconds.

## Follow-up

- Confirm the routing suggestion appears in an interactive session.
