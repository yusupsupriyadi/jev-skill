# jev for Claude Code

Claude Code plugin that hands two decisions to [TypeSafe Jev](https://typesafe.ai) through
[OpenRouter](https://openrouter.ai/~typesafe/jev-latest): **which skill fits the work you just asked for**,
and **what is wrong with the change a turn just made**.

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

Everything is advisory. No hook ever blocks a tool call or stops Claude from finishing.

## Install

```bash
claude plugin marketplace add yusupsupriyadi/jev-skill
claude plugin install jev@jev-skill
```

Then give it an OpenRouter key, either as an environment variable:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

or through `/plugin` in Claude Code: pick **jev**, choose **Configure**, and paste the key. Jev has
no free tier, so the key needs prepaid credit.

Check the install:

```
/jev:doctor
```

Without a key the plugin stays completely idle. It never errors, never blocks, and never injects anything.

## Cost

Routing sends your prompt plus the description of every installed skill. On a machine with about
500 skills that is roughly 25,000 to 30,000 input tokens per routed prompt, near $0.001. Judgment
sends the diff and costs less. Short prompts, acknowledgements, and anything starting with `/` are
skipped before any call is made.

To cut the bill, exclude namespaces you never route to:

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
| `openrouter_api_key` | `OPENROUTER_API_KEY` | none |
| `model` | `JEV_MODEL` | `~typesafe/jev-latest` |
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
- An OpenRouter API key with credit

No npm dependencies.

## Known limits

- The Decisions API is in alpha. If OpenRouter moves the path, set `JEV_API_URL`.
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
