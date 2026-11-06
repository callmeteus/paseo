export type PriceTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface PriceTierSpan {
  min: PriceTier;
  max: PriceTier;
}

const PER_TOKEN_RATE_CEILING = 0.001;
const TOKENS_PER_MILLION = 1_000_000;

/**
 * Steps on the higher of the input and output rates, in USD per million tokens.
 * $20 and above is the top step, so a frontier model and a specialist pro model
 * share $$$$$.
 */
const TIER_CUTS_USD_PER_MILLION = [0.5, 2, 8, 20] as const;

const FREE_MODEL_PATTERN = /(?:^|[^a-z0-9])free(?:[^a-z0-9]|$)|:free\b/i;

/**
 * Published output rates for catalogs that do not send a token price. A model
 * whose id contains mini or nano is left unset: those sizes do not share one rate.
 */
const FALLBACK_OUTPUT_USD_PER_MILLION: readonly { pattern: RegExp; output: number }[] = [
  { pattern: /fable/i, output: 50 },
  { pattern: /opus/i, output: 25 },
  { pattern: /sonnet/i, output: 15 },
  { pattern: /haiku[- ]5/i, output: 0.5 },
  { pattern: /haiku/i, output: 5 },
  { pattern: /gpt-[\d.]+-pro|(?:^|[^a-z0-9])o\d-pro(?:[^a-z0-9]|$)/i, output: 80 },
  { pattern: /(?:^|[^a-z0-9])o1(?:[^a-z0-9]|$)/i, output: 60 },
  { pattern: /gpt-4-turbo/i, output: 30 },
  { pattern: /gpt-5\.[5-9]/i, output: 30 },
  { pattern: /gpt-4o/i, output: 10 },
  { pattern: /gpt-4\.1/i, output: 8 },
  { pattern: /(?:^|[^a-z0-9])gpt-4(?:[^a-z0-9]|$)/i, output: 60 },
  { pattern: /gpt-5/i, output: 10 },
  { pattern: /(?:^|[^a-z0-9])o3(?:[^a-z0-9]|$)/i, output: 8 },
  { pattern: /gemini[\w.-]*pro/i, output: 12 },
  { pattern: /deepseek/i, output: 1.2 },
  { pattern: /grok/i, output: 6 },
  { pattern: /gemini|flash/i, output: 1.8 },
];

function readFiniteRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Peak USD per million tokens, or null when the model did not publish a rate. */
function readPublishedPeak(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const cost = (metadata as { cost?: unknown }).cost;
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) return null;
  const record = cost as { input?: unknown; output?: unknown };
  const input = readFiniteRate(record.input);
  const output = readFiniteRate(record.output);
  if (input === null && output === null) return null;
  const peak = Math.max(input ?? 0, output ?? 0);
  if (peak > 0 && peak < PER_TOKEN_RATE_CEILING) return peak * TOKENS_PER_MILLION;
  return peak;
}

function fallbackPeak(id: string, label: string | null | undefined): number | null {
  const haystack = `${id} ${label ?? ""}`;
  if (FREE_MODEL_PATTERN.test(haystack)) return 0;
  if (/mini|nano/i.test(haystack)) return null;
  for (const rule of FALLBACK_OUTPUT_USD_PER_MILLION) {
    if (rule.pattern.test(haystack)) return rule.output;
  }
  return null;
}

export function tierFromUsdPerMillion(peak: number): PriceTier {
  if (peak <= 0) return 0;
  if (peak < TIER_CUTS_USD_PER_MILLION[0]) return 1;
  if (peak < TIER_CUTS_USD_PER_MILLION[1]) return 2;
  if (peak < TIER_CUTS_USD_PER_MILLION[2]) return 3;
  if (peak < TIER_CUTS_USD_PER_MILLION[3]) return 4;
  return 5;
}

export function resolveModelPriceTier(input: {
  id: string;
  label?: string | null;
  metadata?: unknown;
}): PriceTier | null {
  const published = readPublishedPeak(input.metadata);
  const peak = published === null ? fallbackPeak(input.id, input.label) : published;
  if (peak === null) return null;
  return tierFromUsdPerMillion(peak);
}

export function summarizePriceTiers(
  tiers: readonly (PriceTier | null | undefined)[],
): PriceTierSpan | null {
  let min: PriceTier | null = null;
  let max: PriceTier | null = null;
  for (const tier of tiers) {
    if (tier === null || tier === undefined) continue;
    if (min === null || tier < min) min = tier;
    if (max === null || tier > max) max = tier;
  }
  if (min === null || max === null) return null;
  return { min, max };
}

export function formatPriceMarks(span: PriceTierSpan, freeLabel: string): string {
  if (span.min === 0 && span.max === 0) return freeLabel;
  if (span.min === span.max) return "$".repeat(span.min);
  if (span.min === 0) return `${freeLabel}–${"$".repeat(span.max)}`;
  return `${"$".repeat(span.min)}–${"$".repeat(span.max)}`;
}
