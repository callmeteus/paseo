---
title: Slack triggers
description: Configure Slack mentions and thread replies in one workflow file.
nav: Slack
order: 68
category: Hub
---

# Slack triggers

`slack.mention` fires when the bot is mentioned in a channel where it is present. Direct messages and slash commands do not produce this trigger.

`.paseo/workflows/slack-help.yml`:

```yaml
name: slack-help
on: slack.mention
max_runtime: 1h
filters:
  workspace: T01234567
  channels: [C01234567]
  from_users: [U01234567]
steps:
  - id: answer
    environment: dev
    max_runtime: 30m
    idle_timeout: 5m
    agent: codex
    prompt:
      - text: |
          Answer with hub.reply, then call hub.finish_execution.
          ${{ paseo.prompt }}
    allow_outputs:
      - { type: slack.reply, max: 1, required: true }
```

Slack filters use IDs, not display names or Hub connection slugs. `from_users` matches the author, `workspace` the team, and `channels` the channel. `pattern` is a required prefix after the mention; `contains` is its legacy alias and has the same prefix behavior. All filters must pass.

The reply posts in the triggering thread. A root message gets a thread; a threaded message stays there. `slack.reply` grants `hub.reply`, but does not add reply instructions to the prompt.

Leading declared inputs follow the mention:

```text
@Paseo repo=project agent=claude investigate the failed sync
```

Hub consumes consecutive declared headers and exposes the remainder as `${{ paseo.prompt }}`. See [Workflows](/docs/hub/workflows).

## Find your Slack IDs

| Filter       | Where to copy it                                                                            |
| ------------ | ------------------------------------------------------------------------------------------- |
| `workspace`  | Open Slack in a browser. The team ID is the `T…` segment of the URL.                        |
| `from_users` | Your avatar → **Profile** → **⋮** → **Copy member ID**. Member IDs start with `U`.          |
| `channels`   | Channel name → **About**. The channel ID is at the bottom of the panel and starts with `C`. |

[Guided setup](/docs/hub/quickstart) fills `workspace` from the Slack app you connected and asks you for your member ID, so a generated starter already carries both.

## Plan feedback

`slack_agent.feedback: true` lets the agent put choices on the card. The agent sends them with `slack_finish`, and it chooses the labels. Omit `choices` and the card has no buttons. A click is a new arrival on the same thread, and the prompt names the option the person picked. A `conversation` continuation sends it to the same agent, including in the middle of a turn. Text, regex, and the mention token do not apply. `from_users`, `channels`, `workspace`, and the connection still do.

The Slack app has to have interactivity turned on. See [Slack for Hub](/docs/hub/self-hosting/slack-app).
