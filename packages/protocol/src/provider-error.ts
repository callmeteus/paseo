/**
 * Shared by the daemon and the app: the daemon decides whether a provider reported a
 * failure, the app decides how to present it. Keep the patterns in one place or the two
 * sides disagree about what counts as an error.
 */

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
// Covers auth, authenticate, authentication and authorization without also matching
// "author". Matching only "authentication" missed "Failed to authenticate", which is how
// Cursor words an expired OAuth session.
const AUTH_PATTERN =
  /(unauthori[sz]ed|\bauth(?:enticat|oriz)?\w*|oauth|api[ _-]?key|credential|login|sign[ -]?in|forbidden|(?:^|[^\d])(?:401|403)(?:[^\d]|$))/i;
const MODEL_PATTERN =
  /(model.*(?:not found|not available|unavailable|invalid)|invalid model|unknown model)/i;
const CRASH_PATTERN =
  /(helper server exited|process exited|exited \(\d+\)|transport|econnreset|epipe|socket hang up|connection reset|terminated unexpectedly)/i;

/**
 * Providers usually report failures through a turn-failed event. Some CLIs — Cursor's, for
 * one — print the failure as ordinary assistant text instead, so both sides have to
 * recognize the shape: the daemon to turn it into a system error, the app to show a card.
 */
const FAILURE_OPENER_PATTERN =
  /^(?:failed to|failure[:\s]|error[:\s]|request failed|unauthori[sz]ed|forbidden|invalid api key|invalid token|authentication (?:failed|required|error)|could not |unable to |cannot |can't )/i;
const STRUCTURED_TEXT_PATTERN = /^(?:#{1,6}\s|[-*]\s|\d+\.\s|```|\|)/m;
// A failure line is one statement, sometimes followed by an instruction. Anything that
// moves on to another capitalized sentence reads as the model narrating, not failing.
const SENTENCE_BREAK_PATTERN =
  /[.!?]\s+(?!(?:please|run|try|check|retry|re-?run|then|make|update|upgrade|restart|log)\b)[A-Z]/;
const MAX_FAILURE_CHARS = 220;

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

/**
 * An unprefixed failure is believed only when it reads like one: a single short paragraph
 * that opens with a failure verb and carries a cause we can name. A model discussing
 * authentication in prose keeps its normal message.
 */
export function looksLikeProviderFailureText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_FAILURE_CHARS) {
    return false;
  }
  if (STRUCTURED_TEXT_PATTERN.test(trimmed) || trimmed.includes("\n\n")) {
    return false;
  }
  if (SENTENCE_BREAK_PATTERN.test(trimmed)) {
    return false;
  }
  if (!FAILURE_OPENER_PATTERN.test(trimmed)) {
    return false;
  }
  return classifyProviderError(trimmed) !== "unknown";
}

/** The error to show for an assistant message, or null when the message is ordinary text. */
export function readProviderErrorText(text: string): string | null {
  if (isSystemErrorText(text)) {
    return systemErrorMessage(text);
  }
  return looksLikeProviderFailureText(text) ? text.trim() : null;
}
