# Changelog

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
