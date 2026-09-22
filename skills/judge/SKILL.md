---
description: Have Jev judge the current uncommitted changes for unverified completion claims, missing tests, hardcoded credentials, risk level, and which reviewer fits. Use before committing, or when asked whether a change is safe or finished.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *)
---

# Jev judgment of the working tree

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" judge || true`

## What to do with this

Act on the findings, in this order:

1. **Hardcoded credential** flagged: stop and show the user the exact line before doing anything else.
2. **Unverified claim**: run the project's real verification command and report what it prints. Never restate that the work passes without that output.
3. **Missing test**: add or update the test, unless the change is documentation, formatting, or config.
4. **Risk medium or high**: say so plainly in your summary to the user.
5. **Reviewer suggested**: dispatch that subagent if the change warrants it.

Findings are advisory and calibrated. A low-confidence finding is worth a sentence, not a refactor.
