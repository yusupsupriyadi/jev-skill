---
description: Connect jev to a Jev provider in one pass - pick TypeSafe or OpenRouter, paste a key, verify it live, save it. Use when jev has no API key, when a key was rotated, or when switching provider.
argument-hint: [typesafe|openrouter]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" *), AskUserQuestion
---

# jev setup

Current state:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" setup --status || true`

## Run the setup

Work through these in order. Do not ask anything the state above already answers.

**1. Already working?** If `key:` is set, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" doctor`.
If it prints `OK`, tell the user jev is connected, name the provider and the latency, and stop.
Continue only if the key is missing or the probe fails.

**2. Pick a provider.** If `$ARGUMENTS` names one, use it. Otherwise ask with AskUserQuestion,
header "Provider", one question, these two options:

- **TypeSafe** - the first-party System One API. Key from https://console.typesafe.ai/keys
- **OpenRouter** - one key for many models, handy if the user already has one. Needs prepaid credit. Key from https://openrouter.ai/settings/keys

**3. Get the key.** Ask the user to paste the key for the provider they chose, and give them the
matching link above. Say that you will verify it before anything is saved.

**4. Save it.** Run exactly this, substituting the provider id and the pasted key:

```
printf '%s' 'PASTED_KEY' | node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" setup --provider PROVIDER_ID --key -
```

The key goes in through stdin so it never becomes a command-line argument. Never write it to a
file in the project, never echo it back, and never put it in a commit.

**5. Report.** On success, tell the user which provider answered, the latency, and that routing and
judging begin on their next prompt. On failure, show the reason the command printed, and offer to
try the other provider or a different key.

## If the user wants to change something later

- Switch provider or replace a rotated key: run this skill again.
- Forget the stored key: `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" setup --reset`
- An environment variable, `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`, always wins over the stored key.
