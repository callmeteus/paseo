# Model routers

A router groups provider+model targets behind one choice. The daemon stores them in
`agents.modelRouters` in `config.json`, and each chat records the `modelRouterId` it
is bound to.

- `fallback` starts a chat on the first target and moves to the next when a provider
  reports a credits, quota, or rate-limit failure.
- `distribution` spreads new chats across targets with weighted round-robin.
- `icon` stores a model-icon id, and the app draws that mark for the router. With `icon`
  unset, the app draws the mark of the router's models.

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

## Automatic provider routers

The built-in `provider-routers` plugin keeps a second automatic set under the
`auto-provider:` id prefix, rebuilt from the live catalogue:

- One `distribution` router per active provider, free targets first.
- One `fallback` router per model that two or more providers offer, grouped by
  model identity and ordered free first. This is the open-weight rule applied to
  every model, so an open-weight model appears in both this set and the daemon's
  `auto-open-weight:` set.
- `Premium Free` and `Open Weight Free` fallback routers, built from the same
  presets the app's settings card offers (`packages/protocol/src/router-presets.ts`).

Every sync replaces the `auto-provider:` set and preserves every other router,
including the daemon's `auto-open-weight:` set, and skips the config patch when
nothing changed.

A per-model router sets `hideModelsInSearch`, so the models it covers leave the
cross-provider model search instead of appearing twice. Browsing a single
provider still lists them; the flag only affects the general search list.

The plugin starts the catalogue watcher from its contribution, so the routers
exist once the daemon has settled, and then follows `paseo.providers`. A `sync`
RPC rebuilds the set on demand.
