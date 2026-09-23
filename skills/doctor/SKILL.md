---
name: jev-doctor
description: Check the jev plugin setup (API key, provider, model slug, endpoint, catalog size) and send one live probe to Jev. Use when jev gives no skill suggestions, when a Jev call errors, after installing the plugin, or when the user asks whether jev is working.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *)
---

# jev doctor

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" doctor || true`

## Reading the result

Find the first line below that matches the output. It names the cause and the one thing to do.

| Output | Cause | What to do |
|---|---|---|
| `api key: MISSING` | jev has no key, so routing and judging stay idle | Run `/jev:setup`, or set `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` and restart. A key entered through `/plugin` shows up here from the next session on |
| `FAIL ...: The API key was rejected` | The key is wrong or was revoked | Run `/jev:setup` with a new key |
| `FAIL ...: Payment required` | The account has no credit. Neither provider has a free tier | Add credit at the provider |
| `FAIL ...: Model or endpoint not found` | A model slug was renamed, or the endpoint moved | Set `JEV_MODEL` to a slug that works, or `JEV_API_URL` to the new endpoint |
| `FAIL ...: timed out` or `Jev call failed` | The network or the provider did not answer | Retry once, then check the connection or a proxy |
| `OK` with a `note: ... failed` | The configured slug failed but another one answered | Tell the user to set `JEV_MODEL` to the slug that worked |
| `catalog: 0 routable entries` | Skill discovery found nothing, so routing has nothing to suggest | If `host agent` reads unknown, set `JEV_PLATFORM`. Plugins loaded with `--plugin-dir` go in `JEV_EXTRA_PLUGIN_DIRS` |
| `routing: off` or `judging: off` | The user turned that part off | Nothing, unless they want it back: `route_enabled`, `judge_enabled` |

When everything reads `OK`, say jev is connected and name the provider and the latency.

Report in two lines at most: what state jev is in, and the one action to take. Do not paste the
whole output back unless the user asks for it.

## Running the CLI on another agent

Claude Code fills in `${CLAUDE_PLUGIN_ROOT}` and runs the line starting with `!` before you read
this, putting its output in its place. On any other agent that line arrives as plain text: run
the command yourself with `$JEV_HOME` in place of `${CLAUDE_PLUGIN_ROOT}`, where `JEV_HOME` is a
clone of https://github.com/yusupsupriyadi/jev-skill. `npx skills add` copies the skill folders
but not the `scripts/` directory the CLI lives in.
