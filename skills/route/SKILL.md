---
name: jev-route
description: Ask Jev which installed skill, command, or subagent fits a piece of work. Use when you are unsure which skill to reach for, or when the user asks what to use for a task.
argument-hint: [what you want to do]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *)
---

# Jev routing

Jev compared the request below against every skill, command, and subagent installed in this session and returned a calibrated pick.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" route "$ARGUMENTS" || true`

## What to do with this

- The suggestion is probabilistic, not an instruction. Read the description and decide whether it actually fits.
- If it fits, invoke that skill with the Skill tool, or dispatch that subagent, before continuing.
- If it does not fit, say so in one line and carry on with your own judgement.
- If the output says no key is configured, tell the user to run `/jev:doctor`.

## Running the CLI on another agent

The commands above locate the jev CLI through `${CLAUDE_PLUGIN_ROOT}`, which Claude Code sets. On any
other agent, set `JEV_HOME` to this plugin directory and run `node "$JEV_HOME/scripts/cli.mjs"` instead.
