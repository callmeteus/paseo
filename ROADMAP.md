# Roadmap

## Backlog

- [ ] **R-013** Bound timeline items in memory, prioritize active chats
      priority: high · status: planned · added: 2026-11-19
      Daemon RSS reached 1,012 MiB with 21,737 timeline items across 13 agents, one agent holding 6,628 items. Connection count stayed at 19, so memory growth follows accumulated timelines rather than client count. Cap the number of timeline items kept in memory per agent and in total. Keep full recent history for chats that are running or have an active foreground turn, and trim inactive chats first. The persisted timeline rows already hold the full history, so hydrate older chats from disk when the user opens them instead of keeping everything resident.
  - A hard cap limits in-memory timeline items per agent and across the daemon, independent of how many agents exist.
  - Chats that are running or have an active foreground turn keep their recent items; inactive chats are trimmed first.
  - Opening an older chat still shows its full history, loaded from persistence on demand.
  - Trimming does not drop new items, break streaming, or change what the client sees for an active chat.
  - Peak RSS and timeline item counts are observable, so the effect of the cap can be measured. See [docs/daemon-startup-performance.md](docs/daemon-startup-performance.md).

- [ ] **R-012** Startup initialization metric for the daemon
      priority: high · status: planned · added: 2026-11-19
      Startup is where the daemon spends most CPU. It reaches "listening" in about 0.5 s but only settles after 4 to 9 s of reconciliation, provider probing and speech setup, with repeated failures. There is no metric for that window. Emit one startup record with time to bootstrap complete, time to listening, time to full initialization, CPU user and system time, peak RSS, and a breakdown by phase. Base it on the `elapsed` bootstrap logs and the `ws_runtime_metrics` payload. See [docs/daemon-startup-performance.md](docs/daemon-startup-performance.md) for the measurements.
  - One startup record per daemon launch, visible in `daemon.log` and usable as a regression baseline.
  - The record separates time to listening from time to full initialization, so a fast listen cannot hide slow background work.
  - CPU is split into user and system time, since file inventory shows up mostly as system time.
  - Peak RSS and the observer file count are included, so growth in watched trees is visible.
  - Agent and timeline item counts are included, since daemon memory grows with accumulated timelines.

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
