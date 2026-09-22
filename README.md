# jev for Claude Code

Claude Code plugin that hands two decisions to [TypeSafe Jev](https://typesafe.ai): **which skill fits
the work you just asked for**, and **what is wrong with the change a turn just made**.

Reach Jev either way, through the TypeSafe API directly or through an OpenRouter key you already
have. `/jev:setup` asks which, verifies the key, and saves it.

Jev is not a chat model. It returns no prose. You give it a `state` and typed questions, and it
returns calibrated probabilities in roughly 70 to 500 ms, for $0.042 per million input tokens with
free output. That makes it cheap enough to run on every prompt, and useless for anything that needs
writing. Claude still does all the work; Jev only decides.

## What it does

| Surface | When it runs | What it does |
|---|---|---|
| Skill routing | Every prompt, automatically | Compares your request against every installed skill, command, and subagent, and suggests the best fit with a confidence number |
| Turn judgment | After a turn that changed files or ran commands | Asks whether the turn claimed success without verifying, whether a test is missing, whether a credential leaked, how risky the change is, and which reviewer fits |
| `/jev:ask` | You or Claude invoke it | Runs any typed question you compose against any state |
| `/jev:route` | You invoke it | Routing on demand, for a task you describe |
| `/jev:judge` | You invoke it | Judges the current working tree and prints the findings |
| `/jev:doctor` | You invoke it | Checks the setup and sends one live probe |
| `/jev:setup` | You invoke it | Picks a provider, verifies a key, saves it |

Everything is advisory. No hook ever blocks a tool call or stops Claude from finishing.

## Why use it

Four reasons, with the numbers taken from a real install of 537 skills, commands, and subagents.

**The skill you installed months ago actually fires.** A well equipped Claude Code install carries
hundreds of skills. Claude does see their descriptions, but picking one out of 537 is a side task
while it is busy doing the work you asked for. Jev does nothing else. On a sample of six Indonesian
prompts it named a sensible skill every time, including `vercel:deploy` for a deploy request and
`ecc:security-review` for a security review. Six prompts is a small sample, so treat it as a smoke
test rather than a benchmark.

**A number you can set a threshold on.** Claude chooses a skill silently and you never learn how
sure it was. Jev returns the whole distribution, so a clear case and a close call look different:

| Request | Pick | Share of the vote |
|---|---|---|
| review keamanan endpoint upload | `ecc:security-review` | 0.99 |
| perbaiki bug login di safari | `ecc:orch-fix-defect` | 0.53, with `superpowers:systematic-debugging` at 0.46 |

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

Two commands, then one skill. Nothing to edit by hand.

```bash
claude plugin marketplace add yusupsupriyadi/jev-skill
claude plugin install jev@jev-skill
```

Restart Claude Code, then run:

```
/jev:setup
```

It asks which provider you want, takes your key, checks it against the live API, and saves it. A
wrong key is reported on the spot and nothing is written. When it succeeds, routing and judging
start on your next prompt.

### Two ways to reach Jev

| | TypeSafe | OpenRouter |
|---|---|---|
| Endpoint | `api.typesafe.ai/v1/systemone` | `openrouter.ai/api/alpha/decisions` |
| Model slug | `jev-latest` | `~typesafe/jev-latest` |
| Key from | [console.typesafe.ai/keys](https://console.typesafe.ai/keys) | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Environment variable | `TYPESAFE_API_KEY` | `OPENROUTER_API_KEY` |
| Worth knowing | First-party API | One key across many models. Needs prepaid credit |

Same request and response shape either way, so switching is a matter of running `/jev:setup` again.

If you would rather not use the wizard, set the environment variable for your provider, or fill the
key in through `/plugin`. An environment variable always wins over a stored key.

Without a key the plugin stays completely idle. It never errors, never blocks, and never injects
anything. Check anything at any time with `/jev:doctor`.

## Keeping the cost down

Short prompts, acknowledgements, and anything starting with `/` are skipped before any call is
made. Routing sends your prompt plus the description of every installed skill, so the bill scales
with the catalog. To shrink it, exclude namespaces you never route to:

```bash
export JEV_ROUTE_EXCLUDE="ecc:,vercel:"
```

## Privacy

Read this before installing on work you cannot share.

- **Routing** sends your prompt text and the names and descriptions of your installed skills to OpenRouter, which forwards them to TypeSafe.
- **Judgment** sends the assistant's final message, the paths of changed files, the shell commands the turn ran, and by default the `git diff` of those files.

Turn off what you do not want to send:

| To stop sending | Set |
|---|---|
| The diff, keeping paths and line counts | `send_diff: false` |
| Anything after a turn | `judge_enabled: false` |
| Your prompts | `route_enabled: false` |

## Configuration

Every option is a plugin option in `/plugin`, and every one can be overridden by an environment
variable, which wins.

| Option | Environment variable | Default |
|---|---|---|
| `provider` | `JEV_PROVIDER` | whichever key is present, else `typesafe` |
| `typesafe_api_key` | `TYPESAFE_API_KEY` | none |
| `openrouter_api_key` | `OPENROUTER_API_KEY` | none |
| | `JEV_MODEL` | the provider default slug |
| `route_enabled` | `JEV_ROUTE` | `true` |
| `judge_enabled` | `JEV_JUDGE` | `true` |
| `route_min_confidence` | `JEV_MIN_CONFIDENCE` | `0.5` |
| `include_agents` | `JEV_INCLUDE_AGENTS` | `true` |
| `route_exclude` | `JEV_ROUTE_EXCLUDE` | empty |
| `send_diff` | `JEV_SEND_DIFF` | `true` |
| `timeout_ms` | `JEV_TIMEOUT_MS` | `2500` |
| | `JEV_API_URL` | `https://openrouter.ai/api/alpha/decisions` |
| | `JEV_EXTRA_PLUGIN_DIRS` | empty |
| | `JEV_DEBUG` | off |

## How routing works

A `choice` question accepts at most 255 options, and a well-equipped Claude Code install has more
skills than that. So routing is a tournament rather than one big question:

1. The catalog is split into chunks of 200 candidates.
2. Every chunk votes in parallel, each returning its best option or `none`.
3. One more call runs the chunk winners off against each other.
4. In parallel with all of that, one cheap call asks whether the prompt is even a request for work, and how large it is.

Nothing is cached, so a skill you install mid-session is routable on the next prompt, and no skill
is ever missed because a stored label was wrong.

## Where the judgment appears

Claude Code ignores `systemMessage` and `additionalContext` on the `Stop` hook, so a verdict cannot
be shown the moment a turn ends. The judgment is written to disk and injected at the top of your
**next** prompt instead, then deleted. For a verdict right now, run `/jev:judge`.

## Requirements

- Claude Code 2.1.x or newer
- Node.js 20 or newer, already required by Claude Code
- A TypeSafe key, or an OpenRouter key with credit

No npm dependencies.

## Known limits

- The OpenRouter Decisions API is in alpha. If the path moves, set `JEV_API_URL`.
- Plugins loaded with `--plugin-dir` are not in the plugin registry and cannot be discovered. List them in `JEV_EXTRA_PLUGIN_DIRS`.
- Routing quality depends entirely on how well your skills describe themselves.

## Development

```bash
npm test
claude plugin validate . --strict
claude --plugin-dir .
```

The test suite covers catalog discovery, transcript slicing, question construction, threshold logic,
and runs the hooks end to end against a mock Decisions server. No network access is required.

## License

MIT
