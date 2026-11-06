import type { ProviderSnapshotEntry } from "./agent-types.js";
import { omitDisabledModels, type DisabledModelIdsByProvider } from "./disabled-models.js";
import type { ModelRouter, ModelRouterTarget } from "./model-router.js";
import { isFreeModel, isFreeProvider, isOpenWeightModel } from "./open-weight-models.js";

export interface RouterModelCandidate {
  provider: string;
  model: string | null;
  label: string;
  isFree: boolean;
  isOpenWeight: boolean;
  score: number;
}

/** Matches `ModelRouterSchema`'s target cap. */
const MAX_PRESET_TARGETS = 32;

/** Providers whose entire catalog is free to use (kept explicit on purpose). */
const FREE_TIER_PROVIDERS = new Set<string>();

/**
 * Priority tiers for "Premium Free": free models from premium, closed-weight
 * labs only. Open-weight models are excluded from this preset entirely and
 * belong to "Open Weight Free".
 */
const PREMIUM_TIERS: RegExp[] = [
  /(gpt-5(?!-(?:mini|nano))|claude-(?:opus|sonnet)|gemini-(?:3|2\.5-pro)|grok-(?:4|5)|composer)/i,
  /(claude-haiku|gpt-4\.1|gpt-5-(?:mini|nano)|gemini-2\.5-flash|o[34]-(?:mini|pro))/i,
];

/**
 * Priority tiers for "Open Weight Free". Frontier open-weight families first,
 * then large general models, then small/edge models.
 */
const OPEN_WEIGHT_TIERS: RegExp[] = [
  /(deepseek|qwen|kimi|glm|minimax)/i,
  /(mimo|nemotron-ultra|gpt-oss|llama-?4|gemma-4|mistral-large)/i,
  /(nemotron|llama|mistral|gemma|phi|smollm|hermes|granite|olmo)/i,
];

function tierScore(label: string, modelId: string, tiers: RegExp[]): number {
  const haystack = `${label} ${modelId}`;
  const index = tiers.findIndex((tier) => tier.test(haystack));
  return index < 0 ? tiers.length : index;
}

export function collectRouterCandidates(
  entries: readonly ProviderSnapshotEntry[],
  disabledModelIdsByProvider?: DisabledModelIdsByProvider,
): RouterModelCandidate[] {
  const candidates: RouterModelCandidate[] = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const models = omitDisabledModels(
      (entry.models ?? []).filter((model) => model.isSelectable !== false),
      disabledModelIdsByProvider?.[entry.provider],
    );
    for (const model of models ?? []) {
      const isFree =
        isFreeModel({ id: model.id, label: model.label, metadata: model.metadata }) ||
        isFreeProvider({ id: entry.provider, label: entry.label }) ||
        FREE_TIER_PROVIDERS.has(entry.provider);
      const isOpenWeight = isOpenWeightModel({ id: model.id, label: model.label });
      candidates.push({
        provider: entry.provider,
        model: model.id || null,
        label: `${entry.label ?? entry.provider} · ${model.label}`,
        isFree,
        isOpenWeight,
        score: tierScore(model.label, model.id, PREMIUM_TIERS),
      });
    }
  }
  return candidates;
}

function toTargets(candidates: readonly RouterModelCandidate[]): ModelRouterTarget[] {
  const seen = new Set<string>();
  const targets: ModelRouterTarget[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.provider}::${candidate.model ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ provider: candidate.provider, model: candidate.model });
    // The wire schema caps a router at 32 targets; presets must respect it or
    // the whole daemon-config patch is rejected.
    if (targets.length >= MAX_PRESET_TARGETS) break;
  }
  return targets;
}

function sortForTiers(
  candidates: readonly RouterModelCandidate[],
  tiers: RegExp[],
): RouterModelCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftScore = tierScore(left.label, left.model ?? "", tiers);
    const rightScore = tierScore(right.label, right.model ?? "", tiers);
    return leftScore - rightScore;
  });
}

export type RouterPresetId = "premium-free" | "open-weight-free";

export interface RouterPreset {
  id: RouterPresetId;
  mode: ModelRouter["mode"];
  targets: ModelRouterTarget[];
}

/** Provider chain summary used when a router has no stored summary. */
export function buildRouterSummary(targets: readonly ModelRouterTarget[]): string {
  const providers: string[] = [];
  for (const target of targets) {
    if (!providers.includes(target.provider)) providers.push(target.provider);
  }
  return providers.join(" → ");
}

/**
 * "Premium Free": free closed-weight models from premium labs, best tiers first.
 */
export function buildPremiumFreePreset(
  entries: readonly ProviderSnapshotEntry[],
  disabledModelIdsByProvider?: DisabledModelIdsByProvider,
): RouterPreset | null {
  const candidates = collectRouterCandidates(entries, disabledModelIdsByProvider).filter(
    (candidate) => candidate.isFree && !candidate.isOpenWeight,
  );
  if (candidates.length === 0) return null;
  return {
    id: "premium-free",
    mode: "fallback",
    targets: toTargets(sortForTiers(candidates, PREMIUM_TIERS)),
  };
}

/**
 * "Open Weight Free": free open-weight models only.
 */
export function buildOpenWeightFreePreset(
  entries: readonly ProviderSnapshotEntry[],
  disabledModelIdsByProvider?: DisabledModelIdsByProvider,
): RouterPreset | null {
  const candidates = collectRouterCandidates(entries, disabledModelIdsByProvider).filter(
    (candidate) => candidate.isFree && candidate.isOpenWeight,
  );
  if (candidates.length === 0) return null;
  return {
    id: "open-weight-free",
    mode: "fallback",
    targets: toTargets(sortForTiers(candidates, OPEN_WEIGHT_TIERS)),
  };
}

export function buildRouterPresets(
  entries: readonly ProviderSnapshotEntry[],
  disabledModelIdsByProvider?: DisabledModelIdsByProvider,
): RouterPreset[] {
  return [
    buildPremiumFreePreset(entries, disabledModelIdsByProvider),
    buildOpenWeightFreePreset(entries, disabledModelIdsByProvider),
  ].filter((preset): preset is RouterPreset => preset !== null);
}
