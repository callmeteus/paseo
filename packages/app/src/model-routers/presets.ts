import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ModelRouter, ModelRouterTarget } from "@getpaseo/protocol/model-router";

export interface RouterModelCandidate {
  provider: string;
  model: string | null;
  label: string;
  isFree: boolean;
  isOpenWeight: boolean;
  score: number;
}

const OPEN_WEIGHT_PATTERN =
  /(llama|qwen|deepseek|mistral|mixtral|gpt-oss|kimi|glm|gemma|phi-?\d|nemotron|minimax|hermes|falcon|yi-|olmo|granite|smollm)/i;

const FREE_HINT_PATTERN = /(?:^|[^a-z])(free|gratis|gratuito)(?:[^a-z]|$)|:free\b/i;

/** Providers whose entire catalog is free to use (kept explicit on purpose). */
const FREE_TIER_PROVIDERS = new Set<string>();

/**
 * Priority tiers used to order "Premium Free" targets. Earlier tiers win; a
 * model that matches no tier still participates after all tiers.
 */
const PREMIUM_TIERS: RegExp[] = [
  /(gpt-5|claude-(?:opus|sonnet)|gemini-2\.5-pro|gemini-3)/i,
  /(claude-haiku|gpt-4\.1|gpt-5-mini|gemini-2\.5-flash|deepseek-v3)/i,
  /(qwen|kimi|glm|minimax|nemotron)/i,
  /(gpt-oss|llama|mistral|gemma)/i,
];

const OPEN_WEIGHT_TIERS: RegExp[] = [
  /(deepseek|qwen|kimi|glm|minimax)/i,
  /(gpt-oss|llama-?4|nemotron)/i,
  /(llama|mistral|gemma|phi)/i,
];

function readCostIsZero(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const cost = (metadata as { cost?: unknown }).cost;
  if (!cost || typeof cost !== "object") return false;
  const values = Object.values(cost as Record<string, unknown>).filter(
    (value): value is number => typeof value === "number",
  );
  return values.length > 0 && values.every((value) => value === 0);
}

function tierScore(label: string, modelId: string, tiers: RegExp[]): number {
  const haystack = `${label} ${modelId}`;
  const index = tiers.findIndex((tier) => tier.test(haystack));
  return index < 0 ? tiers.length : index;
}

export function collectRouterCandidates(
  entries: readonly ProviderSnapshotEntry[],
): RouterModelCandidate[] {
  const candidates: RouterModelCandidate[] = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    for (const model of entry.models ?? []) {
      if (model.isSelectable === false) continue;
      const haystack = `${model.label} ${model.id}`;
      const freeByHint = FREE_HINT_PATTERN.test(haystack);
      const freeByCost = readCostIsZero(model.metadata);
      const isFree = freeByHint || freeByCost || FREE_TIER_PROVIDERS.has(entry.provider);
      const isOpenWeight = OPEN_WEIGHT_PATTERN.test(haystack);
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

export interface RouterPreset {
  id: string;
  name: string;
  mode: ModelRouter["mode"];
  targets: ModelRouterTarget[];
}

/**
 * "Premium Free": every free-ish installed model, best tiers first.
 */
export function buildPremiumFreePreset(
  entries: readonly ProviderSnapshotEntry[],
): RouterPreset | null {
  const candidates = collectRouterCandidates(entries).filter((candidate) => candidate.isFree);
  if (candidates.length === 0) return null;
  return {
    id: `preset-premium-free-${Date.now()}`,
    name: "Premium Free",
    mode: "fallback",
    targets: toTargets(sortForTiers(candidates, PREMIUM_TIERS)),
  };
}

/**
 * "Open Weight Free": free-ish installed open-weight models only.
 */
export function buildOpenWeightFreePreset(
  entries: readonly ProviderSnapshotEntry[],
): RouterPreset | null {
  const candidates = collectRouterCandidates(entries).filter(
    (candidate) => candidate.isFree && candidate.isOpenWeight,
  );
  if (candidates.length === 0) return null;
  return {
    id: `preset-open-weight-${Date.now()}`,
    name: "Open Weight Free",
    mode: "fallback",
    targets: toTargets(sortForTiers(candidates, OPEN_WEIGHT_TIERS)),
  };
}

export function buildRouterPresets(entries: readonly ProviderSnapshotEntry[]): RouterPreset[] {
  return [buildPremiumFreePreset(entries), buildOpenWeightFreePreset(entries)].filter(
    (preset): preset is RouterPreset => preset !== null,
  );
}

/** Human-readable target summary for settings rows. */
export function describeRouterTarget(target: ModelRouterTarget): string {
  return target.model ? `${target.provider} · ${target.model}` : `${target.provider} · padrão`;
}
