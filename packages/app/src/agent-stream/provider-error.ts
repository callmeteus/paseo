export const SYSTEM_ERROR_PREFIX = "[System Error]";

export type ProviderErrorKind =
  | "usage_limit"
  | "credits_exhausted"
  | "auth"
  | "rate_limit"
  | "model_unavailable"
  | "crash"
  | "unknown";

const CREDITS_PATTERN =
  /(insufficient credits?|purchase more credits|buy (?:more )?credits|add (?:more )?credits|out of credits|no credits? (?:left|remaining)|credit balance)/i;
const USAGE_LIMIT_PATTERN =
  /(quota|credit|insufficient|exhausted|billing|payment|rate.?limit|too many requests|usage limit|limit (?:reached|exceeded)|daily limit|hourly limit|free tier|out of (?:tokens|credits)|(?:^|[^\d])(?:402|429)(?:[^\d]|$))/i;
const AUTH_PATTERN =
  /(unauthori[sz]ed|authentication|api[ _-]?key|credential|login|sign[ -]?in|forbidden|(?:^|[^\d])(?:401|403)(?:[^\d]|$))/i;
const MODEL_PATTERN =
  /(model.*(?:not found|not available|unavailable|invalid)|invalid model|unknown model)/i;
const CRASH_PATTERN =
  /(helper server exited|process exited|exited \(\d+\)|transport|econnreset|epipe|socket hang up|connection reset|terminated unexpectedly)/i;

export function classifyProviderError(message: string): ProviderErrorKind {
  if (CRASH_PATTERN.test(message)) return "crash";
  if (AUTH_PATTERN.test(message)) return "auth";
  if (MODEL_PATTERN.test(message)) return "model_unavailable";
  // An empty balance is not a rolling usage window: it needs credits, not a model switch.
  if (CREDITS_PATTERN.test(message)) return "credits_exhausted";
  if (USAGE_LIMIT_PATTERN.test(message)) return "usage_limit";
  return "unknown";
}

export function isSystemErrorText(text: string): boolean {
  return text.startsWith(SYSTEM_ERROR_PREFIX);
}

export function systemErrorMessage(text: string): string {
  return isSystemErrorText(text) ? text.slice(SYSTEM_ERROR_PREFIX.length).trim() : text.trim();
}
