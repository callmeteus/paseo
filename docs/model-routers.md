# Model routers

A router groups provider+model targets behind one choice. The daemon stores them in
`agents.modelRouters` in `config.json`, and each chat records the `modelRouterId` it
is bound to.

- `fallback` starts a chat on the first target and moves to the next when a provider
  reports a credits, quota, or rate-limit failure.
- `distribution` spreads new chats across targets with weighted round-robin.

Fallback execution runs in the app
(`packages/app/src/model-routers/use-router-fallback.ts`). The daemon only stores the
router and the chat binding.

## Automatic open-weight routers

The daemon keeps one fallback router per open-weight model and rebuilds the set from
the global provider catalogue whenever it changes, including the 30-minute catalogue
refresh. The first sync runs after the daemon's startup warmup settles.

- Targets are ordered free first, then paid. A free tier and a paid tier of the same
  model share one router.
- Model identity ignores an owner prefix and a free-tier marker (`:free`,
  `-free`, `_free`), so `deepseek/deepseek-v4-flash:free` and `deepseek-v4-flash`
  group together.
- A provider whose id or label contains "free" (for example "OpenCode Free") counts
  as free even when its models carry no cost metadata.
- A model offered by only one target is skipped: a router needs a second target to
  fall back to.
- Automatic routers use the `auto-open-weight:` id prefix. Every sync replaces that
  set and preserves routers with any other id. Editing an automatic router by hand
  does not survive the next refresh; create a router with a different id to keep
  custom targets.

`packages/protocol/src/open-weight-routers.ts` generates the routers and
`packages/server/src/server/agent/open-weight-routers.ts` watches the catalogue and
writes them. The open-weight and free classifiers live in
`packages/protocol/src/open-weight-models.ts` so the app presets and the daemon agree.
