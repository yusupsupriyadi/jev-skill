---
name: jev-doctor
description: Check the jev plugin setup - API key, model slug, endpoint, catalog size - and send one live probe to Jev. Use when jev produces no suggestions, when a Jev call errors, or right after installing the plugin.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *)
---

# jev doctor

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" doctor || true`

## Reading the result

- `api key: MISSING` means jev is idle. Set `OPENROUTER_API_KEY`, or run `/plugin`, pick jev, and fill in the key.
- A `402` means the OpenRouter key has no credits. Jev has no free tier.
- If the configured slug fails but the fallback works, tell the user to set `JEV_MODEL` to the one that worked.
- `catalog: 0 routable entries` means discovery found nothing, so routing can never fire.

## Running the CLI on another agent

The commands above locate the jev CLI through `${CLAUDE_PLUGIN_ROOT}`, which Claude Code sets. On any
other agent, set `JEV_HOME` to this plugin directory and run `node "$JEV_HOME/scripts/cli.mjs"` instead.
