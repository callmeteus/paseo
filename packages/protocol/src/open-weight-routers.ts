import type { ProviderSnapshotEntry } from "./agent-types.js";
import type { ModelRouter, ModelRouterTarget } from "./model-router.js";
import {
  isFreeModel,
  isFreeProvider,
  isOpenWeightModel,
  normalizeModelIdentity,
} from "./open-weight-models.js";

/** Auto-generated routers are owned by this prefix; user routers never match it. */
export const AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX = "auto-open-weight:";

/** Matches `ModelRouterSchema`'s target cap. */
const MAX_ROUTER_TARGETS = 32;
const MAX_ROUTER_NAME_LENGTH = 80;
const MAX_ROUTER_SUMMARY_LENGTH = 200;

interface ModelTarget {
  provider: string;
  providerLabel: string;
  providerOrder: number;
  model: string;
  modelLabel: string;
  isFree: boolean;
}

export interface ModelFallbackRouterOptions {
  /** Id prefix for the generated routers. */
  idPrefix: string;
  /** Which catalogue models take part in a router. */
  include: (model: { id: string; label?: string | null }) => boolean;
  /** Hide each router's targets from cross-provider search. */
  hideModelsInSearch?: boolean;
}

export function isAutoOpenWeightRouter(router: Pick<ModelRouter, "id">): boolean {
  return router.id.startsWith(AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX);
}

/**
 * One fallback router per model identity, with every free target before the
 * first paid one. A model offered by a single target has nothing to fall back
 * to, so it is skipped.
 */
export function buildModelFallbackRouters(
  entries: readonly ProviderSnapshotEntry[],
  options: ModelFallbackRouterOptions,
): ModelRouter[] {
  const groups = new Map<string, ModelTarget[]>();

  entries.forEach((entry, providerOrder) => {
    if (!entry.enabled || entry.status !== "ready") return;
    for (const model of entry.models ?? []) {
      if (model.isSelectable === false) continue;
      if (!options.include({ id: model.id, label: model.label })) continue;
      const identity = normalizeModelIdentity(model.id);
      if (!identity) continue;
      const targets = groups.get(identity) ?? [];
      targets.push({
        provider: entry.provider,
        providerLabel: entry.label ?? entry.provider,
        providerOrder,
        model: model.id,
        modelLabel: model.label,
        isFree:
          isFreeModel({ id: model.id, label: model.label, metadata: model.metadata }) ||
          isFreeProvider({ id: entry.provider, label: entry.label }),
      });
      groups.set(identity, targets);
    }
  });

  const routers: ModelRouter[] = [];
  const usedIds = new Set<string>();
  for (const [identity, rawTargets] of groups) {
    const targets = dedupeTargets(rawTargets);
    if (targets.length < 2) continue;
    const ordered = targets.sort(compareTargets).slice(0, MAX_ROUTER_TARGETS);
    const id = uniqueRouterId(options.idPrefix, identity, usedIds);
    usedIds.add(id);
    routers.push({
      id,
      name: truncate(resolveRouterName(ordered, identity), MAX_ROUTER_NAME_LENGTH),
      summary: truncate(buildRouterSummary(ordered), MAX_ROUTER_SUMMARY_LENGTH),
      mode: "fallback",
      targets: ordered.map(({ provider, model }): ModelRouterTarget => ({ provider, model })),
      ...(options.hideModelsInSearch ? { hideModelsInSearch: true } : {}),
    });
  }

  return routers.sort((left, right) => left.name.localeCompare(right.name));
}

/** One fallback router per open-weight model across the provider catalogue. */
export function buildOpenWeightRouters(entries: readonly ProviderSnapshotEntry[]): ModelRouter[] {
  return buildModelFallbackRouters(entries, {
    idPrefix: AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX,
    include: (model) => isOpenWeightModel(model),
  });
}

/** Preserves user routers and replaces the previous automatic set. */
export function mergeAutoOpenWeightRouters(
  existing: readonly ModelRouter[],
  generated: readonly ModelRouter[],
): ModelRouter[] {
  return [...existing.filter((router) => !isAutoOpenWeightRouter(router)), ...generated];
}

function dedupeTargets(targets: readonly ModelTarget[]): ModelTarget[] {
  const seen = new Set<string>();
  const unique: ModelTarget[] = [];
  for (const target of targets) {
    const key = `${target.provider}::${target.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

function compareTargets(left: ModelTarget, right: ModelTarget): number {
  if (left.isFree !== right.isFree) return left.isFree ? -1 : 1;
  if (left.providerOrder !== right.providerOrder) return left.providerOrder - right.providerOrder;
  return left.model.localeCompare(right.model);
}

function resolveRouterName(targets: readonly ModelTarget[], identity: string): string {
  const labels = targets
    .map((target) => cleanModelLabel(target.modelLabel))
    .filter((label) => label.length > 0);
  // Catalogs such as Kilo prefix the provider ("Kilo Gateway/DeepSeek: ...").
  // Prefer a plain label and then the shortest one so the router reads like a
  // model name instead of a catalog path.
  const plain = labels.filter((label) => !label.includes(":") && !label.includes("/"));
  const candidates = (plain.length > 0 ? plain : labels).sort(
    (left, right) => left.length - right.length,
  );
  return candidates[0] ?? identity;
}

function cleanModelLabel(label: string): string {
  return label
    .replace(/\s*[([:-]?\s*(free|gratis|gratuito)\s*[)\]]?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRouterSummary(targets: readonly ModelTarget[]): string {
  const providers: string[] = [];
  for (const target of targets) {
    if (!providers.includes(target.providerLabel)) providers.push(target.providerLabel);
  }
  if (providers.length >= 2) return providers.join(" → ");
  const models = targets.map((target) => cleanModelLabel(target.modelLabel) || target.model);
  return `${providers[0] ?? targets[0]!.provider} · ${models.join(" → ")}`;
}

function uniqueRouterId(idPrefix: string, identity: string, usedIds: ReadonlySet<string>): string {
  const base = `${idPrefix}${routerIdSlug(identity) || "model"}`.slice(0, 128);
  if (!usedIds.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, 120)}-${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
  }
}

function routerIdSlug(identity: string): string {
  return identity
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
