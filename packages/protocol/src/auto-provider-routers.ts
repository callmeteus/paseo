import type { ProviderSnapshotEntry } from "./agent-types.js";
import { omitDisabledModels, type DisabledModelIdsByProvider } from "./disabled-models.js";
import type { ModelRouter, ModelRouterTarget } from "./model-router.js";
import { buildModelFallbackRouters } from "./open-weight-routers.js";
import { isFreeModel, isFreeProvider } from "./open-weight-models.js";
import {
  buildOpenWeightFreePreset,
  buildPremiumFreePreset,
  type RouterPreset,
} from "./router-presets.js";

/**
 * Routers the provider-routers plugin owns. The daemon replaces every router
 * with this id prefix on each sync and preserves everything else.
 */
export const AUTO_PROVIDER_ROUTER_ID_PREFIX = "auto-provider:";

const MODEL_ROUTER_ID_PREFIX = `${AUTO_PROVIDER_ROUTER_ID_PREFIX}model:`;

/** Matches `ModelRouterSchema`'s id, name, summary, and target caps. */
const MAX_ROUTER_ID_LENGTH = 128;
const MAX_ROUTER_NAME_LENGTH = 80;
const MAX_ROUTER_SUMMARY_LENGTH = 200;
const MAX_ROUTER_TARGETS = 32;

const PREMIUM_FREE_SUMMARY =
  "Free models from premium labs, strongest first, ending on cheaper models.";
const OPEN_WEIGHT_FREE_SUMMARY =
  "Free open-weight models, frontier families first, smaller models last.";

export function isAutoProviderRouter(router: Pick<ModelRouter, "id">): boolean {
  return router.id.startsWith(AUTO_PROVIDER_ROUTER_ID_PREFIX);
}

/**
 * Every router the plugin keeps in sync: one distribution router per provider,
 * one fallback router per model that several providers offer (free targets
 * first), and the Premium Free and Open Weight Free presets.
 */
export function buildProviderRouters(
  entries: readonly ProviderSnapshotEntry[],
  disabledModelIdsByProvider?: DisabledModelIdsByProvider,
): ModelRouter[] {
  const available = entries.map((entry) =>
    hideDisabledModels(entry, disabledModelIdsByProvider?.[entry.provider]),
  );

  return [
    ...buildProviderDistributionRouters(available, disabledModelIdsByProvider),
    ...buildModelFallbackRouters(available, {
      idPrefix: MODEL_ROUTER_ID_PREFIX,
      include: () => true,
      // The cross-provider rows duplicate the router, so they leave the general
      // list; browsing a provider still shows every model.
      hideModelsInSearch: true,
    }),
    ...presetRouters(available, disabledModelIdsByProvider),
  ];
}

export function mergeAutoProviderRouters(
  existing: readonly ModelRouter[],
  generated: readonly ModelRouter[],
): ModelRouter[] {
  return [...existing.filter((router) => !isAutoProviderRouter(router)), ...generated];
}

function buildProviderDistributionRouters(
  entries: readonly ProviderSnapshotEntry[],
  disabledModelIdsByProvider?: DisabledModelIdsByProvider,
): ModelRouter[] {
  const routers: ModelRouter[] = [];
  const usedIds = new Set<string>();

  for (const entry of entries) {
    if (!entry.enabled || entry.status !== "ready") continue;
    const models =
      omitDisabledModels(
        (entry.models ?? []).filter((model) => model.isSelectable !== false),
        disabledModelIdsByProvider?.[entry.provider],
      ) ?? [];
    if (models.length === 0) continue;

    const label = entry.label ?? entry.provider;
    const targets = [...models]
      // Free targets first; `sort` is stable, so catalogue order holds inside
      // each group.
      .sort((left, right) => Number(isFree(entry, right)) - Number(isFree(entry, left)))
      .slice(0, MAX_ROUTER_TARGETS)
      .map((model): ModelRouterTarget => ({ provider: entry.provider, model: model.id }));

    routers.push({
      id: uniqueId(
        `${AUTO_PROVIDER_ROUTER_ID_PREFIX}${slug(entry.provider) || "provider"}`,
        usedIds,
      ),
      name: truncate(label, MAX_ROUTER_NAME_LENGTH),
      summary: truncate(`${models.length} models from ${label}`, MAX_ROUTER_SUMMARY_LENGTH),
      mode: "distribution",
      targets,
    });
  }

  return routers;
}

function presetRouters(
  entries: readonly ProviderSnapshotEntry[],
  disabledModelIdsByProvider?: DisabledModelIdsByProvider,
): ModelRouter[] {
  const routers: ModelRouter[] = [];
  const presets: [RouterPreset | null, string, string][] = [
    [
      buildPremiumFreePreset(entries, disabledModelIdsByProvider),
      "Premium Free",
      PREMIUM_FREE_SUMMARY,
    ],
    [
      buildOpenWeightFreePreset(entries, disabledModelIdsByProvider),
      "Open Weight Free",
      OPEN_WEIGHT_FREE_SUMMARY,
    ],
  ];
  for (const [preset, name, summary] of presets) {
    if (!preset) continue;
    routers.push({
      id: `${AUTO_PROVIDER_ROUTER_ID_PREFIX}${preset.id}`,
      name,
      summary,
      mode: preset.mode,
      targets: preset.targets,
    });
  }
  return routers;
}

function hideDisabledModels(
  entry: ProviderSnapshotEntry,
  disabledIds: readonly string[] | undefined,
): ProviderSnapshotEntry {
  if (!entry.models || !disabledIds?.length) return entry;
  const models = omitDisabledModels(entry.models, disabledIds);
  if (!models) return entry;
  return { ...entry, models };
}

function isFree(
  entry: ProviderSnapshotEntry,
  model: { id: string; label: string; metadata?: unknown },
): boolean {
  return (
    isFreeModel({ id: model.id, label: model.label, metadata: model.metadata }) ||
    isFreeProvider({ id: entry.provider, label: entry.label })
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function uniqueId(base: string, usedIds: ReadonlySet<string>): string {
  const trimmed = base.slice(0, MAX_ROUTER_ID_LENGTH);
  if (!usedIds.has(trimmed)) return trimmed;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, MAX_ROUTER_ID_LENGTH - 4)}-${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
