---
title: Slack triggers
description: Start Hub agents from Slack channel and thread mentions and reply in thread.
nav: Slack
order: 67
category: Hub
---

# Slack triggers

`slack.mention` fires when someone mentions the bot in a Slack channel or thread where the bot is present. Direct messages, slash commands, and interactive components do not fire this event.

First connect a Slack workspace under **Integrations** (or configure a [Slack app](/docs/hub/self-hosting/slack-app) on a self-hosted Hub) and invite the bot to the channels it watches.

`.paseo/triggers/slack-help.yml`:

```yaml
name: slack-help
on:
  slack.mention:
    connection: acme-slack
    filters:
      workspace: T01234567
      channels: [C01234567]
      from_users: [U01234567]
run:
  target:
    daemon: devbox
    cwd: /workspace/project
  agent:
    provider: codex
    mode: full-access
  continuation:
    mode: conversation
  max_runtime: 30m
  idle_timeout: 5m
  prompt: |
    Answer the request using reply, then call finish_execution.

    <user-prompt>
    ${{ paseo.prompt }}
    </user-prompt>
  outputs:
    slack.reply:
      max: 1
      required: true
```

## Filters and prompt text

Slack filters use IDs, not display names or connection slugs. All filters compose with AND:

- `from_users` is required and matches the sender's Slack member ID.
- `workspace` matches the Slack team ID and `channels` limits which channels can trigger the run.
- `pattern` requires a prefix after the mention (`contains` is its legacy alias with the same prefix behavior).

`${{ paseo.prompt }}` contains the full message. Hub parses leading `key=value` tokens after the mention for inputs you declare. If you declare `inputs.repo`, use `${{ paseo.inputs.repo }}` in `run.prompt` to insert its value.

```text
@Paseo repo=project investigate the failed sync
```

Include `${{ paseo.context }}` in `run.prompt` to pass the Slack thread history and execution-scoped attachment descriptors as JSON.

## Replies and continuation

Hub posts replies in the triggering Slack thread. A channel message starts a thread, and a reply inside a thread stays in that thread. Follow-up mentions in the same thread continue the same agent by default.

Slack triggers automatically grant the `reply` tool (`slack.reply`). Declare `run.outputs.slack.reply` when you want to cap `max` replies or set `required: true`. When Hub runs over HTTPS, replies include an **Open in Paseo** link.

To read or post to Slack channels from a schedule, webhook, or another trigger, use [Integration tools](/docs/hub/tools). To give the agent repository access, add a [`run.github` block](/docs/hub/github).

## Find your Slack IDs

| Filter       | Where to copy it                                                                           |
| ------------ | ------------------------------------------------------------------------------------------ |
| `workspace`  | Open Slack in a browser. The team ID is the `T...` segment of the URL.                     |
| `from_users` | Open your avatar, then **Profile**, then **⋮**, then **Copy member ID** (starts with `U`). |
| `channels`   | Open the channel name, then **About**. The channel ID is at the bottom (starts with `C`).  |

`paseo hub init` reads the Slack connection automatically and prompts only for your member ID.

## Plan feedback

`slack_agent.feedback: true` lets the agent put choices on the card. The agent sends them with `slack_finish`, and it chooses the labels. Omit `choices` and the card has no buttons. A click is a new arrival on the same thread, and the prompt names the option the person picked. A `conversation` continuation sends it to the same agent, including in the middle of a turn. Text, regex, and the mention token do not apply. `from_users`, `channels`, `workspace`, and the connection still do.

The Slack app has to have interactivity turned on. See [Slack for Hub](/docs/hub/self-hosting/slack-app).

## Hub-enforced presentation and tool policy

A step with `slack_agent` can let the Hub own the thread's lifecycle reactions. When
`lifecycle_reactions` is set, the Hub reacts with `on_start` when the execution starts and
`on_finish` when it completes or fails. Both names are data from the document; the Hub does not
know any bot's wording. The model does not need to call `react` for those two moments.

```yaml
run:
  slack_agent:
    display: timeline
    lifecycle_reactions:
      on_start: eyes
      on_finish: white_check_mark
  denied_tools: [question]
  outputs:
    slack.reply:
      max: 1
    slack.read_messages:
      max: 4
      args_limit:
        limit: 10
```

`denied_tools` names tools the Hub must not grant or accept in this run. Denied names are dropped
from the granted tool set and rejected at the capability boundary. The same names are forwarded
to the provider as `disallowedTools` when the provider supports them. `outputs.slack.reply.max`
caps replies for the whole execution; `args_limit` sets numeric maxima Hub checks on each tool
call, so a model asking for more than the configured `limit` gets an error instead of a larger
read. All three options are optional and change nothing when omitted.

## Tasks, text, and thumbs

A step that opts into `slack_agent` draws the agent's own plan on the card. Each task in a `todo` timeline row becomes a task on that card, with `task_display_mode` taken from `slack_agent.display`. The model can still call `slack.agent.stage`. When both name the same task id, the explicit call wins.

Assistant text is appended as it arrives. A turn that is only text does not invent tasks. A reply that outlives the ten-minute stream is posted with `chat.postMessage`.

Thumbs sit on the finished card. A click is stored in `organization_response_feedback` and does not start a run. `feedback_search` reads that table. `memory_search` still returns only findings.

The first task, or the first diff, opens a Slack Code channel when the app has `code_channels:manage`. The thread stream continues when Slack answers `missing_scope` or `not_agent_channel`. The diff tab shows the patch. The channel is archived when the run ends.
