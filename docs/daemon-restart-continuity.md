# Daemon restart continuity

What survives a daemon restart and what does not. The daemon keeps durable records under
`$PASEO_HOME` but rebuilds its runtime from them on boot. Read this before adding a new
in-memory map whose contents should outlive the process.

## Durable state

These are restored on boot and are not open issues:

- Agent records, labels, ownership, goals, attention, timestamps, and provider persistence
  handles. Runtime sessions resume lazily when a chat is opened or prompted.
- Provider history. A resumed agent rebuilds missed timeline rows from it. The client keeps an
  authoritative replica and re-pages catch-up after reconnect.
- Projects, workspaces, workspace labels (including the journaled compound commit), message
  queues, finish subscriptions, creation journal, schedules, push tokens, connected hosts, Hub
  relationship, semantic permissions, and the managed-process ledger.
- Config, server ID, E2EE keypair, and the supervisor's published endpoint in `paseo.pid`.

## Restart recovery

Agents recorded as `running` are continuation candidates. On a graceful stop the daemon saves
intent before closing runtimes; on boot it chooses candidates before repairing persisted status,
then sends `resumePrompt` in the background after connections open. A slow provider holds back
only its own agent. Config `agents.resumeOnStartup` (default true) disables it; `agents.resumePrompt`
changes the prompt. Archived, private, owned, and archived-workspace agents are excluded.

Pending plan builds are stored in `$PASEO_HOME/plan-builds.json`. Boot re-dispatches them so a plan
file does not stay half-done with a stale `building` marker. Reconciling provider history on resume
keeps the stored attention reason instead of flattening permission, error, and question states to
`finished`.

The schedule ticker stops before shutdown closes agents, and a tick already in flight refuses to
claim another run once stop has begun. An interrupted Hub disconnect is retried on the next start
instead of deleting the local relationship.

The app treats a daemon restart as a new connection epoch: it rebuilds host discovery, re-reads
message queues, and restarts authoritative timeline catch-up. Host observation and queue hydration
are keyed by epoch, not just by client identity.

## Known gaps

These are runtime-only by design or still unimplemented. Do not treat them as data loss from a
durable store unless the underlying record is missing.

- **Terminals.** Terminal sessions and PTY buffers live in the terminal manager. A daemon restart
  kills them; the client's restore mode only reattaches to a still-live terminal.
- **Goal auto-continuation.** `goal.status: "active"` is persisted, but the continuation timer is
  in memory. A restart inside the 1.5 s window leaves the goal idle until a new user turn.
- **Plan builds** now re-dispatch, but the build turn is a fresh turn; work the interrupted turn
  had already done is in provider history and is not replayed as a new prompt.
- **Crash retry budget.** `crashRecoveryAttempts` and its timers are in memory. A restart inside
  the retry delay leaves the error card with no automatic retry. Running turns are covered by
  restart recovery instead.
- **Workspace setup.** Setup runs and their status snapshots are in-memory. An in-flight
  `paseo.json` setup is aborted with no persisted status.
- **Service proxy.** Registered routes, script runtime entries, and dynamic service-port plans
  reset. A detached service that survives the daemon is unreachable until re-registered.
- **Worker restart environment.** `paseo daemon restart` reuses the supervisor's original launch
  arguments and environment. Changed `PASEO_*` overrides need a stop and start.
- **Agent message window.** The two-second coalescing window flushes on graceful shutdown but is
  lost on a crash. Finish-subscription notifications have separate durable intent.
- **Directory sequences.** A new random generation per process invalidates client cursors and
  produces a full snapshot. No records are lost.
- **Plugin log tails.** The structured tail is in memory; `plugin.logs.get.request` is authoritative.
