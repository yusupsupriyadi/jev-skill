# jev-ai

The installer for [jev](https://github.com/yusupsupriyadi/jev-skill): typed decisions for coding
agents from TypeSafe Jev. It tells you which of your installed skills fits a request, and judges
the change a turn just made.

```bash
npx jev-ai
```

It asks where jev should go (this project, or every project), which agents get it, and whether
to connect a TypeSafe or OpenRouter key, then copies the five skills and the CLI they call. Claude
Code can take jev as a plugin instead, which adds a skill suggestion on every prompt and a
judgment after every turn.

Supported agents: Claude Code, Codex, Cursor, Gemini CLI, Antigravity, OpenCode, Kimi Code,
Hermes, GitHub Copilot.

Run it again to update. The full documentation is in the
[repository README](https://github.com/yusupsupriyadi/jev-skill#install).
