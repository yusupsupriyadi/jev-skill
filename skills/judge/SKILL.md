---
name: jev-judge
description: Have Jev judge the uncommitted changes in the working tree, new untracked files included, for hardcoded credentials, missing tests, risk level, and which reviewer fits. Use before committing or opening a PR, or when asked whether a change is safe, risky, or ready to commit.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *)
---

# Jev judgment of the working tree

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" judge || true`

## What this run looked at

The files named on the `Judged` line: tracked changes, plus new files git does not track yet,
sent as a diff. It has no transcript, so it cannot tell whether a turn claimed success without
running anything. Claude Code checks that by itself after every turn and puts the verdict at the
top of the next prompt as `[jev] Judgment of the previous turn`.

- `Nothing to judge` means there are no changed files. Say so and stop.
- To judge only what is staged, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" judge --staged`.
  To judge particular files, add `--files a.js,b.js`.

## What to do with the findings

Work through them in this order, because a leaked credential costs the most to undo:

1. **Hardcoded credential**: stop before anything else. Find the line in the diff or the new
   file and show it to the user with its path. Do not stage, commit, or push it. Suggest reading
   the value from an environment variable, and rotating the key if it was ever pushed.
2. **Missing test**: add or update the test, unless the change is documentation, formatting, or
   configuration. If someone else is making the change, name the behaviour that has no test.
3. **Risk medium or high**: say so plainly in your summary, with what the change touches.
4. **Reviewer suggested**: dispatch that subagent if the change warrants a second look.

`No findings` means nothing crossed a threshold. It is not proof the change is correct: Jev read
the diff, it did not run the code.

## Reading the raw answers

| Answer | Meaning | Becomes a finding at |
|---|---|---|
| `secrets` | Probability the diff adds a real-looking credential | 0.7 |
| `needs_tests` | Probability the change needs a new or updated test | 0.7 |
| `risk` | 0 trivial, 1 low, 2 medium, 3 high | 2 |
| `reviewer` | The best-fitting review subagent, or `none` | confidence 0.6 |

A number just under its threshold is worth a sentence to the user, not a refactor.

## When the judgment came from the previous turn

`[jev] Judgment of the previous turn` can also say the turn claimed the work was done with no
verification run. Then run the project's real verification command and report what it prints.
Never restate that the work passes without that output.

## Running the CLI on another agent

Claude Code fills in `${CLAUDE_PLUGIN_ROOT}` and runs the line starting with `!` before you read
this, putting its output in its place. On any other agent that line arrives as plain text: run
the command yourself with `$JEV_HOME` in place of `${CLAUDE_PLUGIN_ROOT}`, where `JEV_HOME` is a
clone of https://github.com/yusupsupriyadi/jev-skill. `npx skills add` copies the skill folders
but not the `scripts/` directory the CLI lives in.
