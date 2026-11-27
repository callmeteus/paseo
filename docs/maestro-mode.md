# Maestro mode

Maestro is the third chat mode alongside Chat (OpenUI) and Agent. It orchestrates Paseo agents instead of doing the work itself.

## Where the behaviour comes from

The daemon downloads `skills/maestro` from [`gtihq/ai-skills`](https://github.com/gtihq/ai-skills) into `$PASEO_HOME/maestro/skill`. `MaestroSkillService` checks `master` for a new commit every 30 minutes and on startup. A failed check keeps the local copy and falls back to a short inline contract when no copy exists. The downloaded `SKILL.md` becomes the system prompt, followed by a Paseo-specific section (worker spawning, scope, ledger location, context recommendation).

The `/gti skills update` pathway updates the same upstream skill in the agent harness directories. Paseo's daemon copy is independent, so a Maestro chat keeps working without a configured coding agent's skill directory.

## State

The mode lives on chat labels, like the OpenUI label:

- `paseo.maestro = "1"` marks a Maestro chat.
- `paseo.maestro.scope = "workspace" | "all"` controls whether workers may be created in the current workspace only or in any workspace.

Each Maestro chat has a ledger at `$PASEO_HOME/maestro/chats/<agent-id>/`. The daemon creates `run.json` on entry. Maestro writes the rest of the ledger (`workers.jsonl`, decisions, review files) from its own tools. On every user turn the daemon reads `run.json` and the last 20 `workers.jsonl` lines and attaches a short digest to the provider prompt. That is what keeps the run trackable after context compaction.

## UI

Selecting Maestro shows a dedicated landing surface with the scope choice and the large-context recommendation. Worker chats spawned from the Maestro chat carry `paseo.parent-agent-id`, and appear as small live blocks inside the assistant message. Each block shows the worker's title, provider/model, lifecycle status and latest detail, and opens the worker chat on press.
