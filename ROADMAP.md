# Roadmap

## Backlog

- [ ] **R-011** Apply workflow mode changes to a live runtime
      priority: high · status: planned · added: 2026-10-30
      Today the workflow prompt is composed at launch, so switching Agent, Ask, Debug, or Multitask only changes behavior after the runtime reloads. Evaluate a per-turn preamble like the /goal preamble, an optional AgentSession.setDaemonAppendSystemPrompt hook for providers that recompose each turn, or a controlled reload. Prefer the preamble: it works for every provider and does not interrupt the current turn.
  - Switching the workflow mode in a live chat changes the instructions the next turn receives, without reloading the runtime or losing the conversation.

## Done

- [x] **R-001** Workflow modes (Ask, Debug, Multitask) as a daemon-level axis
      priority: medium · status: done · done: 2026-10-30
- [x] **R-002** Speech model download on Windows fails with tar exit code 1
      priority: high · status: done · done: 2026-10-29
      Background download of parakeet and kokoro models failed because extraction spawned the system tar. Fixed by decompressing and untarring in-process with tar.x and unbzip2.
- [x] **R-003** Workflow mode control and runtime switch RPC
      priority: high · status: done · done: 2026-10-30
      The composer shows Agent, Ask, Debug, and Multitask with their colors. Switching a live chat calls agent.workflow_mode.set.request, persists workflowModeId, and updates the snapshot.
- [x] **R-004** Tailscale access for every dev launcher
      priority: medium · status: done · done: 2026-10-30
      The daemon, Expo, desktop dev, and website bind 0.0.0.0 and print the tailnet URL. Desktop dev now matches the other launchers.
- [x] **R-005** Cursor IDE chat import
      priority: high · status: done · done: 2026-10-30
      Import Cursor chats from the import sheet, with reader, model map, timeline conversion, and a dedicated import RPC.
- [x] **R-006** Promote an agent tab to a workspace
      priority: medium · status: done · done: 2026-10-30
      A chat tab can become its own workspace without losing its timeline or ownership.
- [x] **R-007** Command Code over ACP with a usage source
      priority: medium · status: done · done: 2026-10-29
      Command Code runs as an ACP provider and reports usage through its own source.
- [x] **R-008** Hub automations and local daemon connection from desktop
      priority: high · status: done · done: 2026-10-29
      The desktop app embeds Hub automations and connects the local daemon with a one-time enrollment token.
- [x] **R-009** Provider usage pressure index
      priority: medium · status: done · done: 2026-10-29
      Usage windows from multiple providers combine into one pressure index.
- [x] **R-010** ACP providers fail fast when unresponsive
      priority: medium · status: done · done: 2026-10-30
      A provider that never answers now fails the turn instead of hanging.
