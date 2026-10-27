import { z } from "zod";

/**
 * Model routers group several provider+model targets behind one choice.
 *
 * - `distribution`: each new chat is created on the next target in the list
 *   (weighted round-robin), so work spreads across providers.
 * - `fallback`: a chat starts on the first target and moves to the next one
 *   when the provider reports a retryable failure (credits, quota, rate limit).
 */
export const MODEL_ROUTER_MODES = ["distribution", "fallback"] as const;
export const ModelRouterModeSchema = z.enum(MODEL_ROUTER_MODES);
export type ModelRouterMode = z.infer<typeof ModelRouterModeSchema>;

export const ModelRouterTargetSchema = z
  .object({
    provider: z.string().min(1),
    /** Null/omitted lets the provider choose its default model. */
    model: z.string().min(1).nullable().optional(),
    /** Relative weight for distribution. Defaults to 1. */
    weight: z.number().int().positive().max(1000).optional(),
  })
  .strict();

export type ModelRouterTarget = z.infer<typeof ModelRouterTargetSchema>;

export const ModelRouterSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    mode: ModelRouterModeSchema,
    targets: z.array(ModelRouterTargetSchema).min(1).max(32),
  })
  .strict();

export type ModelRouter = z.infer<typeof ModelRouterSchema>;

export const ModelRouterSettingsSchema = z
  .object({
    routers: z.array(ModelRouterSchema).default([]),
    /** Router applied to new chats when the user has not picked one explicitly. */
    defaultRouterId: z.string().min(1).nullable().optional(),
  })
  .strict();

export type ModelRouterSettings = z.infer<typeof ModelRouterSettingsSchema>;

export const DEFAULT_MODEL_ROUTER_SETTINGS: ModelRouterSettings = { routers: [] };

/** Ordered stored targets, skipping a target that is no longer valid. */
export function normalizeRouterTargets(targets: readonly ModelRouterTarget[]): ModelRouterTarget[] {
  const seen = new Set<string>();
  const normalized: ModelRouterTarget[] = [];
  for (const target of targets) {
    const model = target.model ?? null;
    const key = `${target.provider}::${model ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      provider: target.provider,
      model,
      ...(target.weight ? { weight: target.weight } : {}),
    });
  }
  return normalized;
}

function isValidTarget(target: ModelRouterTarget, installed: ReadonlySet<string>): boolean {
  return installed.has(target.provider);
}

/**
 * Pick the next distribution target using weighted round-robin.
 *
 * `cursor` is a monotonically increasing per-router counter kept by the
 * daemon. Weights expand into slots: [(a,2),(b,1)] yields a,a,b,a,a,b,...
 */
export function selectDistributionTarget(input: {
  router: ModelRouter;
  cursor: number;
  installedProviders: ReadonlySet<string>;
}): { target: ModelRouterTarget; cursor: number } | null {
  const targets = normalizeRouterTargets(
    input.router.targets.filter((target) => isValidTarget(target, input.installedProviders)),
  );
  if (targets.length === 0) return null;
  const slots: ModelRouterTarget[] = [];
  for (const target of targets) {
    const weight = target.weight ?? 1;
    for (let index = 0; index < weight; index += 1) slots.push(target);
  }
  const slot = ((input.cursor % slots.length) + slots.length) % slots.length;
  return { target: slots[slot], cursor: input.cursor + 1 };
}

/**
 * Next target after `current` in a fallback router. Returns null when the
 * current target is last (or unknown), so the caller stops instead of looping.
 */
export function selectFallbackTarget(input: {
  router: ModelRouter;
  current: { provider: string; model: string | null } | null;
  installedProviders: ReadonlySet<string>;
}): ModelRouterTarget | null {
  const targets = normalizeRouterTargets(
    input.router.targets.filter((target) => isValidTarget(target, input.installedProviders)),
  );
  if (targets.length === 0) return null;
  if (!input.current) return targets[0] ?? null;
  const currentKey = `${input.current.provider}::${input.current.model ?? ""}`;
  const index = targets.findIndex(
    (target) => `${target.provider}::${target.model ?? ""}` === currentKey,
  );
  if (index < 0) {
    // The chat is on a provider outside the router: start from the top.
    return targets[0] ?? null;
  }
  return targets[index + 1] ?? null;
}

const RETRYABLE_FAILURE_PATTERN =
  /(quota|credit|insufficient|exhausted|billing|payment|rate.?limit|too many requests|usage limit|out of (?:tokens|credits)|limit reached|402|429)/i;

/**
 * Classifies a provider failure as retryable on another target.
 *
 * Provider adapters surface free-form errors plus an optional numeric code, so
 * this is a text classifier. It intentionally stays conservative: unknown
 * failures (auth errors, bad model ids, crashes) do not trigger a fallback.
 */
export function isRetryableRouterFailure(input: {
  error?: string | null;
  code?: string | null;
  diagnostic?: string | null;
}): boolean {
  const text = [input.error, input.code, input.diagnostic].filter(Boolean).join(" ");
  if (!text) return false;
  return RETRYABLE_FAILURE_PATTERN.test(text);
}
