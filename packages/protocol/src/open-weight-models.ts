/**
 * Classification shared by the router presets in the app and the daemon's
 * automatic open-weight routers. Keep the provider-owned identifiers here so
 * both sides agree on what "open weight" and "free" mean.
 */

/** Model families whose weights are published under an open license. */
const OPEN_WEIGHT_MODEL_PATTERN =
  /(llama|qwen|deepseek|mistral|mixtral|gpt-oss|kimi|glm|gemma|phi-?\d|nemotron|minimax|mimo|hermes|falcon|yi-|olmo|granite|smollm|seed-oss|hunyuan|exaone|ernie|dots|step-?\d)/i;

const FREE_HINT_PATTERN = /(?:^|[^a-z])(free|gratis|gratuito)(?:[^a-z]|$)|:free\b/i;

export function isOpenWeightModel(input: { id: string; label?: string | null }): boolean {
  return OPEN_WEIGHT_MODEL_PATTERN.test(`${input.label ?? ""} ${input.id}`);
}

function readCostIsZero(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const cost = (metadata as { cost?: unknown }).cost;
  if (!cost || typeof cost !== "object") return false;
  const values = Object.values(cost as Record<string, unknown>).filter(
    (value): value is number => typeof value === "number",
  );
  return values.length > 0 && values.every((value) => value === 0);
}

export function isFreeProvider(input: { id: string; label?: string | null }): boolean {
  return FREE_HINT_PATTERN.test(`${input.label ?? ""} ${input.id}`);
}

export function isFreeModel(input: {
  id: string;
  label?: string | null;
  metadata?: unknown;
}): boolean {
  return isFreeProvider(input) || readCostIsZero(input.metadata);
}

/**
 * Stable identity for the same model across providers. Drops an owner prefix
 * (`deepseek/deepseek-chat`), a free-tier marker (`:free`, `-free`, `_free`), and
 * case/punctuation differences so a free tier and a paid tier of one model land
 * in the same router.
 */
export function normalizeModelIdentity(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const withoutFreeTag = trimmed.replace(/(?:[:_-]free)$/, "");
  const lastSegment = withoutFreeTag.slice(withoutFreeTag.lastIndexOf("/") + 1);
  return lastSegment.replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}
