---
name: jev-route
description: Ask Jev which installed skill, command, or subagent fits a piece of work, with a confidence number for the pick. Use when you are unsure which skill to reach for, when several look plausible, or when the user asks what to use for a task.
argument-hint: [what you want to do]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *)
---

# Jev routing

Jev compared the request below against every skill, command, and subagent installed for this
agent and returned a calibrated pick.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" route "$ARGUMENTS" || true`

## Reading the result

A line such as `Suggested skill for this request: X (0.62 of the vote, 0.98 that some skill fits)`
carries two numbers that answer different questions:

- **That some skill fits** is the chance that anything on the list suits the request. When it is
  low, the request may not need a skill at all.
- **Of the vote** is X's share against the other candidates. A low share next to a high fit
  means two skills overlap, not that Jev is unsure. When a `Close second` is listed, read both
  descriptions and choose between them rather than taking the first.

The subagent and workflow-size lines are separate estimates with their own confidence.

## What to do with this

- If the pick fits, invoke that skill with the Skill tool, or dispatch that subagent, before
  continuing.
- If it does not fit, say so in one line and carry on with your own judgement.
- `did not find a skill worth suggesting` means nothing cleared the `route_min_confidence` floor.
  Carry on without one.
- `Usage: cli.mjs route` means no request was passed. Run
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" route "<one line describing the task>"` yourself.
- `No API key` means jev is not connected. Tell the user to run `/jev:setup`.

The suggestion is probabilistic, not an instruction. Read the description and decide whether it
really fits.

## Running the CLI on another agent

Claude Code fills in `${CLAUDE_PLUGIN_ROOT}` and `$ARGUMENTS` and runs the line starting with `!`
before you read this, putting its output in its place. On any other agent that line arrives as
plain text: run the command yourself with `$JEV_HOME` in place of `${CLAUDE_PLUGIN_ROOT}` and the
task in place of `$ARGUMENTS`, where `JEV_HOME` is a clone of
https://github.com/yusupsupriyadi/jev-skill. `npx skills add` copies the skill folders but not
the `scripts/` directory the CLI lives in.
