# Changelog

## 0.1.0

First release.

- `/jev:ask` runs any typed question against Jev and returns calibrated probabilities.
- `/jev:route` asks Jev which installed skill, command, or subagent fits a piece of work.
- `/jev:judge` judges the working tree for unverified claims, missing tests, credentials, and risk.
- `/jev:doctor` reports configuration and sends one live probe.
- A `UserPromptSubmit` hook suggests a skill for each prompt.
- A `Stop` hook judges turns that changed files or ran commands, and the verdict is replayed on the next prompt.
