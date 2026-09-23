<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ea44f" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/version-0.4.0-1f6feb" alt="Version 0.4.0">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-5fa04e" alt="Node 20 or newer">
  <img src="https://img.shields.io/badge/dependencies-0-8957e5" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/providers-TypeSafe%20%7C%20OpenRouter-f0883e" alt="TypeSafe or OpenRouter">
</p>

# jev for coding agents

> **Two decisions, handed to a model that does nothing but decide.** Which of your installed skills
> fits the request you just typed, and whether the turn that just finished really did what it said.
> Answers come back as calibrated probabilities in about a second, for a fraction of a cent.

Powered by [TypeSafe Jev](https://typesafe.ai), reachable through the TypeSafe API directly or
through an OpenRouter key you already have.

Jev is not a chat model. It returns no prose. You give it a `state` and typed questions, and it
answers with probabilities, in roughly 70 to 500 ms, for $0.042 per million input tokens with free
output. That makes it cheap enough to run on every prompt, and useless for anything that needs
writing. Claude still does all the work; Jev only decides.

## See it work

Everything below is real output from an install carrying 537 skills, commands, and subagents.

### It names the skill for the job

You type a request. Before Claude reads it, this arrives in its context:

```
[jev] Suggested skill for this request: ecc:security-review (0.99 of the vote, 1.00 that some skill fits).
      Use this skill when adding authentication, handling user input, working with secrets, creating
      API endpoints, or implementing payment/sensitive features. Provides comprehensive security
      checklist and...
[jev] Close second: ecc:code-review (0.01).
[jev] Suggested subagent: ecc:security-reviewer (confidence 0.88).
[jev] Estimated workflow size: major (confidence 0.92).
[jev] This is a fast probabilistic suggestion, not an instruction. Ignore it if it does not fit.
```

Searched 537 entries in 2.1 seconds. When two skills genuinely overlap you see that too, rather
than a false show of certainty: a Safari login bug returns `ecc:orch-fix-defect` at 0.53 with
`superpowers:systematic-debugging` right behind at 0.46, and `none` at 0.00.

### It checks the claim against the record

`/jev:judge` on the uncommitted change that became 0.4.0, which touched the config loader, the
judge, and two new test files git did not track yet:

```
Judged 22 changed file(s): .claude-plugin/marketplace.json, ..., tests/judge.test.mjs, tests/store.test.mjs

Findings:
- Risk of this change reads as medium.
- Consider a review pass with ecc:code-reviewer.

Raw answers:
- needs_tests: 0.60
- secrets: 0.03
- risk: 2.18 (confidence 0.81)
- reviewer: ecc:code-reviewer (confidence 0.60)

Cost: $0.000265
```

On demand it reads the working tree only. After each turn in Claude Code it also gets Claude's
closing message and the commands the turn ran, and a turn that announced success with nothing
run is the finding it exists for.

### It connects in one pass

```
$ /jev:setup

Connected to OpenRouter.
  model:    ~typesafe/jev-latest -> typesafe/jev-1.13-20260917
  latency:  758 ms
  cost:     $0.000013 for that probe
  saved to: ~/.claude/plugins/data/jev/config.json

jev is live. Routing and judging start on your next prompt.
```

A key that does not work is reported here instead of being written to disk and failing on every
later prompt.

## What it does

| Surface | When it runs | What it does |
|---|---|---|
| Skill routing | Every prompt, automatically | Compares your request against every installed skill, command, and subagent, and suggests the best fit with a confidence number |
| Turn judgment | After a turn that changed files or ran commands | Asks whether the turn claimed success without verifying, whether a test is missing, whether a credential leaked, how risky the change is, and which reviewer fits |
| `/jev:setup` | You invoke it | Picks a provider, verifies a key, saves it |
| `/jev:route` | You invoke it | Routing on demand, for a task you describe |
| `/jev:judge` | You invoke it | Judges the current working tree, new untracked files included, and prints the findings |
| `/jev:ask` | You or Claude invoke it | Runs any typed question you compose against any state |
| `/jev:doctor` | You invoke it | Checks the setup and sends one live probe |

Everything is advisory. No hook ever blocks a tool call or stops Claude from finishing.

The slash names are how Claude Code calls the skills. Other agents know them as `jev-setup`,
`jev-route`, `jev-judge`, `jev-ask`, and `jev-doctor`.

## Why use it

Four reasons, with the numbers taken from that same 537-entry install.

**The skill you installed months ago actually fires.** A well equipped Claude Code install carries
hundreds of skills. Claude does see their descriptions, but picking one out of 537 is a side task
while it is busy doing the work you asked for. Jev does nothing else. On a sample of six Indonesian
prompts it named a sensible skill every time. Six prompts is a small sample, so treat that as a
smoke test rather than a benchmark.

**A number you can set a threshold on.** Claude chooses a skill silently and you never learn how
sure it was. Jev returns the whole distribution, so a clear case and a close call look different.
Raise `route_min_confidence` and only the clear ones reach you.

**A check that compares the claim against the record.** The judgment asks fixed questions: did a
verification command run and pass, does the diff need a test, did a credential go in, how risky is
this. It gets Claude's closing message on one side and the commands the turn actually ran on the
other, and answers each question on its own. None of the turn's reasoning reaches it, so a turn
that reports success without running anything reads as exactly that.

**It cannot invent an answer.** Jev picks from the options you hand it. Ask a chat model which skill
to use and it can return a plausible name you have never installed. Jev can only return one of
yours, or `none`.

### What that costs

| | Measured on this install |
|---|---|
| Catalog read per routed prompt | 537 entries, roughly 27,000 tokens |
| Routing | about $0.0004, 1.5 to 4 seconds |
| One judgment | $0.00026 |
| Connection probe | 740 ms |

### When it is not worth it

If you run a handful of skills you do not need help choosing between them. If you always type
`/skill-name` yourself, routing adds nothing, and prompts beginning with `/` are skipped anyway.
The judgment still earns its place at any catalog size.

## Install

One command, for any agent:

```bash
npx jev-ai
```

It asks where jev should go (this project, or every project on the machine), which agents get
it, and whether to connect a key now. Then it copies the five skills into each agent's skills
folder and the CLI they call into `~/.jev`, with that path written into every skill, so there is
nothing to set afterwards. Agents whose folder it finds are ticked for you. Run it again to
update: it shows the version on disk next to the one it carries before it overwrites anything.

For Claude Code it offers the plugin instead of plain skills, and recommends it, because only the
plugin brings the two hooks:

| | Claude Code, as a plugin | Every other agent, or Claude Code with skills only |
|---|---|---|
| `jev-setup`, `jev-ask`, `jev-route`, `jev-judge`, `jev-doctor` | Yes | Yes |
| A skill suggestion on every prompt | Yes | No |
| A judgment after every turn | Yes | No |

Both automatic parts need a hook that fires when a prompt is submitted or a turn ends, and those
are Claude Code hook events. Everywhere else jev runs when you ask for it, which is what the five
skills are for.

### Connect a key

The installer offers this as its last step. To do it later, run the `jev-setup` skill
(`/jev:setup` in Claude Code). It asks which provider you want, takes your key, checks it against
the live API, and saves it; a key that does not work is reported and never saved. Or set
`TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` in your shell profile. An environment variable always
wins over a stored key.

Without a key jev stays completely idle. It never errors, never blocks, and never injects
anything. Check the state at any time with the `jev-doctor` skill.

In Claude Code you can also fill the key in through `/plugin`. Claude Code hands those options
only to hooks, never to the commands a skill runs, so jev copies them into its own store at the
start of each session, and the skills see the key from the next session on. The store is
`~/.claude/plugins/data/jev/config.json`, readable by your user only, and `jev-setup` writes the
same file. On macOS that is a copy outside the Keychain. If you want the key in neither place, use
the environment variable.

### Two ways to reach Jev

| | TypeSafe | OpenRouter |
|---|---|---|
| Endpoint | `api.typesafe.ai/v1/systemone` | `openrouter.ai/api/alpha/decisions` |
| Model slug | `jev-latest` | `~typesafe/jev-latest` |
| Key from | [console.typesafe.ai/keys](https://console.typesafe.ai/keys) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Environment variable | `TYPESAFE_API_KEY` | `OPENROUTER_API_KEY` |
| Worth knowing | First-party API | One key across many models. Needs prepaid credit |

Same request and response shape either way, so switching providers is a matter of running
`jev-setup` again. A key is only ever sent to the provider it was saved against.

### Other ways to install

| Route | Command | Then |
|---|---|---|
| Claude Code plugin | `claude plugin marketplace add yusupsupriyadi/jev-skill`, then `claude plugin install jev@jev-skill` | Nothing: this is what the installer runs when you pick the plugin |
| skills.sh | `npx skills add yusupsupriyadi/jev-skill` | It copies the skills but not the CLI. Clone this repository and set `JEV_HOME` to the clone |
| Codex | `codex plugin marketplace add yusupsupriyadi/jev-skill`, then `codex plugin add jev@jev-skill` | Set `JEV_HOME` to the plugin's folder |
| Kimi Code | `/plugins install https://github.com/yusupsupriyadi/jev-skill` | Set `JEV_HOME` to the plugin's folder |
| Cursor | Add the marketplace through Cursor's Customize interface | Set `JEV_HOME` to the plugin's folder |

### Where the skills land

| Agent | Project | Global |
|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `.codex/skills/` | `~/.agents/skills/` |
| Cursor | `.cursor/skills/` | `~/.cursor/skills/` |
| Gemini CLI | `.gemini/skills/` | `~/.gemini/skills/` |
| Antigravity | `.agents/skills/` | `~/.gemini/config/skills/` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` |
| Kimi Code | `.agents/skills/` | `~/.agents/skills/` |
| Hermes | `.hermes/skills/` | `~/.hermes/skills/` |
| GitHub Copilot | `.agents/skills/` | `~/.github/skills/` |

jev scans only the directories belonging to the agent running it, so a skill installed for one
agent is never suggested to a host that cannot load it. Claude Code identifies itself through its
environment; for any other agent set `JEV_PLATFORM`. The `jev-doctor` skill shows which agent jev
thinks it is running under and which skills directories it found.

### Remove

- Installed with `npx jev-ai`: delete the `jev-*` folders from each agent's skills folder, and `~/.jev`.
- The Claude Code plugin: `claude plugin uninstall jev@jev-skill`.
- The stored key: `node ~/.jev/scripts/cli.mjs setup --reset` before you delete `~/.jev`, or delete `~/.claude/plugins/data/jev/config.json`.

**What is verified:** Claude Code as a plugin, end to end, on Windows, plus a clean install
through `npx skills add`. What `npx jev-ai` writes is covered by tests, including a run of the
copied CLI. The other agents follow the published skills convention, but no live install on them
has been confirmed. If you run jev on one, an issue saying whether it worked is welcome.

## What leaves your machine

Read this before installing on work you cannot share.

- **Routing** sends your prompt text, plus the names and descriptions of your installed skills, to your provider.
- **Judgment** sends Claude's closing message, the paths of changed files, the shell commands the turn ran, and by default the `git diff` of those files.

Turn off whatever you do not want to send:

| To stop sending | Set |
|---|---|
| The diff, keeping paths and line counts | `send_diff: false` |
| Anything after a turn | `judge_enabled: false` |
| Your prompts | `route_enabled: false` |

## Configuration

Every option appears in `/plugin`, and every one can be overridden by an environment variable,
which wins.

| Option | Environment variable | Default |
|---|---|---|
| `provider` | `JEV_PROVIDER` | whichever key is present, else `typesafe` |
| `typesafe_api_key` | `TYPESAFE_API_KEY` | none |
| `openrouter_api_key` | `OPENROUTER_API_KEY` | none |
| | `JEV_MODEL` | the provider's default slug |
| `route_enabled` | `JEV_ROUTE` | `true` |
| `judge_enabled` | `JEV_JUDGE` | `true` |
| `route_min_confidence` | `JEV_MIN_CONFIDENCE` | `0.5` |
| `include_agents` | `JEV_INCLUDE_AGENTS` | `true` |
| `route_exclude` | `JEV_ROUTE_EXCLUDE` | empty |
| `send_diff` | `JEV_SEND_DIFF` | `true` |
| `timeout_ms` | `JEV_TIMEOUT_MS` | `2500` |
| | `JEV_API_URL` | the provider's endpoint |
| | `JEV_PLATFORM` | Claude Code when detected, else every agent |
| | `JEV_HOME` | a clone of this repository, for non-Claude agents |
| | `JEV_EXTRA_PLUGIN_DIRS` | empty |
| | `JEV_DEBUG` | off |

### Keeping the cost down

Short prompts, acknowledgements, and anything starting with `/` are skipped before any call is
made. Routing sends the description of every installed skill, so the bill scales with the catalog.
To shrink it, exclude namespaces you never route to:

```bash
export JEV_ROUTE_EXCLUDE="ecc:,vercel:"
```

## How it works

### Routing is a tournament

A `choice` question accepts at most 255 options, and a well stocked Claude Code install has more
skills than that. So routing runs as a tournament rather than one oversized question:

1. The catalog is split into chunks of 200 candidates.
2. Every chunk votes in parallel and contributes its strongest real option.
3. One more call runs those winners off against each other, with `none` on the ballot.
4. Alongside all of that, one cheap call asks whether the prompt is a request for work at all, and how large.

The gate is `1 - P(none)`, the chance that any skill fits, not the winner's own confidence. Two
equally good skills split the vote between them, and suppressing the suggestion there would be the
wrong reading of a distribution that is perfectly sure of itself.

Nothing is cached, so a skill you install mid-session is routable on the next prompt, and no skill
is missed because a stored label was wrong.

### The judgment arrives on your next prompt

Claude Code ignores `systemMessage` and `additionalContext` on the `Stop` hook, so a verdict cannot
be shown the moment a turn ends. The judgment is written to disk and injected at the top of your
**next** prompt instead, then deleted. For a verdict right now, run `/jev:judge`.

## FAQ

**Is Jev a chat model?**
No. It returns no text at all. It reads a state, answers typed questions with probabilities, and
that is the whole of it. Claude still writes every line of code.

**Does it slow my prompt down?**
Routing runs while the prompt is being submitted, and took 1.5 to 4 seconds here against 537
skills. Each call is capped by `timeout_ms`, and if anything fails or times out the prompt goes
through untouched.

**Can it block Claude, or change my code?**
No to both. No hook returns a blocking decision, and nothing in the plugin writes to your
repository. The worst case is a suggestion you ignore.

**Why did it suggest nothing?**
Either Jev read the prompt as conversation rather than a request for work, or nothing cleared
`route_min_confidence`. Run `/jev:route "your request"` to see the numbers, and lower the floor if
it is too strict for your catalog.

**Do I need both providers?**
No, one key is enough. Run `/jev:setup` again to switch.

**Does it work outside Claude Code?**
The five skills do, on any agent that reads the `SKILL.md` convention. Routing on every prompt and
judging after every turn need Claude Code hook events, so elsewhere you run jev when you want it.

**What happens if I never add a key?**
Nothing at all. Every path exits quietly, and your prompts and turns are untouched.

## Requirements and limits

- Claude Code 2.1.x or newer, Node.js 20 or newer, no npm dependencies
- A TypeSafe key, or an OpenRouter key with credit
- The OpenRouter Decisions API is in alpha. If the path moves, set `JEV_API_URL`
- Plugins loaded with `--plugin-dir` are absent from the plugin registry and cannot be discovered. List them in `JEV_EXTRA_PLUGIN_DIRS`
- Routing quality depends entirely on how well your skills describe themselves

## Development

```bash
npm test
claude plugin validate . --strict
claude --plugin-dir .
```

The suite covers catalog discovery, transcript slicing, question construction, provider selection,
threshold logic, and what the installer writes, and runs the hooks end to end against a mock
Decisions server. No network access is required.

The installer lives in `cli/` as its own package, because it needs two dependencies the plugin
does without. To run it from a clone:

```bash
cd cli
npm install
node index.mjs
```

`npm publish` there runs `npm run sync` first, which copies `skills/` and `scripts/` into
`cli/bundle/` and refuses to go on if `cli/package.json` and the plugin carry different versions.

## License

MIT
