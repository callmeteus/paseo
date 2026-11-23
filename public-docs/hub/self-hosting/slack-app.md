---
title: Slack for Hub
description: Connect Slack to your self-hosted Hub over Socket Mode or webhooks.
nav: Slack app
order: 80
category: Hub
---

# Slack for Hub

Slack can reach a self-hosted Hub in two ways:

| Transport   | Public HTTPS required | Best for                                |
| ----------- | --------------------- | --------------------------------------- |
| Socket Mode | No                    | Local, personal, and single-process Hub |
| Webhooks    | Yes                   | Public server deployments               |

Socket Mode is the default in browser setup. Both transports support `slack.mention` triggers, thread replies, and [scoped Slack integration tools](/docs/hub/tools).

## Set up Socket Mode

Open **Apps → Slack** in Hub and keep **Socket Mode** selected. Hub generates the Slack manifest and walks through these steps:

1. Create the Slack app from the generated manifest.
2. Generate an App-level token with the `connections:write` scope.
3. Install the app and copy its Bot User OAuth Token.
4. Paste both tokens into Hub and choose **Connect Slack**.

Hub verifies the installation, saves it under **Integrations**, and opens the outbound Socket Mode connection.

Invite the bot to each channel it watches or posts to:

```text
/invite @Paseo
```

Socket Mode holds one live connection in the Hub process. Run one Hub process for Socket Mode and keep it running because events that arrive while Hub is stopped are missed.

Next, create a [Slack trigger](/docs/hub/triggers/slack).

## Use webhooks

Choose **Webhooks** when Slack sends events to a public Hub. Open Hub at its [public HTTPS address](/docs/hub/self-hosting#public-addresses) before setup so the generated manifest uses the right URLs.

**Apps → Slack** provides a webhook manifest and asks for the **App ID**, **Client ID**, **Client Secret**, and **Signing Secret**. Saving continues to Slack so you can authorize a workspace. Always start workspace installation from Hub so the workspace binds to the active Hub organization.

Slack calls these Hub URLs:

| Provider setting          | Hub URL                                                    |
| ------------------------- | ---------------------------------------------------------- |
| Redirect URL              | `<PASEO_HUB_APP_URL>/api/integrations/slack/callback`      |
| Request URL               | `<PASEO_HUB_APP_URL>/api/integrations/slack/events`        |
| Interactivity Request URL | `<PASEO_HUB_APP_URL>/api/integrations/slack/interactivity` |

An app created before interactivity was part of the manifest does not pick the change up. In **Interactivity & Shortcuts**, turn interactivity on. Socket Mode has no request URL. A webhook app uses the Interactivity Request URL above. No new scope is required, so the app does not need to be reinstalled.

Code channels need a reinstall. The manifest turns on `features.code_channels` and adds the bot scope `code_channels:manage`. Until the workspace app is reinstalled, Hub keeps the thread stream and skips the code channel.

## Configure from environment

Deployments that manage secrets outside Hub can configure one complete transport via environment variables.

Socket Mode:

```dotenv
SLACK_TRANSPORT=socket
SLACK_APP_ID=A01234567
SLACK_APP_TOKEN=xapp-...
```

The Bot User OAuth Token stays attached to each saved Slack workspace under **Integrations** rather than the Socket Mode environment variables.

Webhooks:

```dotenv
SLACK_TRANSPORT=webhook
SLACK_APP_ID=A01234567
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
```

Environment configuration takes precedence over a saved Slack app and appears as **Managed by environment** under **Apps**.
