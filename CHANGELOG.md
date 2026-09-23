# Changelog

## 0.4.0

- A key saved by `/jev:setup` now reaches the routing and judging hooks. Before, setup wrote it where only the `/jev:*` commands looked, so automatic routing and judging stayed idle after setup reported success.
- A key entered through `/plugin` now reaches the `/jev:*` commands as well. Claude Code hands plugin options to hooks only, so jev copies them into its own store when a session starts.
- A provider option left on `auto` no longer hides the provider `/jev:setup` saved.
- Judging includes new files git does not track yet, on demand and after each turn. A credential in a brand-new file used to go unseen.
- `/jev:judge` on a clean tree says there is nothing to judge instead of paying for an empty call. On demand it no longer asks whether the turn claimed success, which it cannot know without a transcript, and it lists the files it judged.
- The skills say how to read what they print: `/jev:doctor` maps each failure to one action, `/jev:route` explains its two numbers, `/jev:judge` its thresholds.
- `/jev:ask` covers batches (one state, one question per item, pointed at with `inspect`), passes files by absolute path, and gives confidence bands and failure handling.
- On agents other than Claude Code, the skills say to run the `!` line themselves, and that `JEV_HOME` must be a clone of this repository, since `npx skills add` does not copy `scripts/`.

## 0.3.0

- Runs on any agent that reads the cross-agent `SKILL.md` convention, not only Claude Code. Manifests ship for Codex, Cursor and Kimi Code, plus a cross-agent marketplace.
- Skill discovery follows the host agent. A skill installed for one agent is never suggested to a host that cannot load it, and `JEV_PLATFORM` names the host when it cannot be detected.
- Every skill now carries a `name` field, which the cross-agent installer requires. Without it `npx skills add` rejected all five.
- `/jev:doctor` reports the host agent and every skills directory it found.

## 0.2.0

- Reach Jev through the TypeSafe API directly, not just OpenRouter. Same request shape, different endpoint, key, and model slug.
- `/jev:setup` connects a provider in one pass: pick, paste the key, verified live, saved. A wrong key is reported and never stored.
- Routing now gates on whether any skill fits rather than on which one won, so two equally good skills no longer suppress the suggestion.
- Error messages no longer name OpenRouter when talking to TypeSafe.

## 0.1.0

First release.

- `/jev:ask` runs any typed question against Jev and returns calibrated probabilities.
- `/jev:route` asks Jev which installed skill, command, or subagent fits a piece of work.
- `/jev:judge` judges the working tree for unverified claims, missing tests, credentials, and risk.
- `/jev:doctor` reports configuration and sends one live probe.
- A `UserPromptSubmit` hook suggests a skill for each prompt.
- A `Stop` hook judges turns that changed files or ran commands, and the verdict is replayed on the next prompt.
