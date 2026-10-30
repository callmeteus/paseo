/**
 * Cursor model names do not follow provider naming, and most chats use models
 * that only exist inside Cursor (`composer-*`, `default`, `auto/*`). This module
 * answers one question: which Paseo provider could continue a chat that was
 * written on a given Cursor model?
 */
export type CursorModelFamily = "claude" | "codex" | "gemini" | "grok" | "cursor" | "unknown";

export interface CursorModelSuggestion {
  family: CursorModelFamily;
  /** True when the Cursor model has a real counterpart outside Cursor. */
  portable: boolean;
  /** Providers to try in order when the chat is continued. */
  preferredProviders: readonly string[];
}

const CURSOR_PROPRIETARY_PREFIXES = ["composer-", "composer/", "cursor-", "auto", "default"];

export function suggestContinuationProvider(
  modelName: string | null | undefined,
): CursorModelSuggestion {
  const normalized = modelName?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return { family: "unknown", portable: false, preferredProviders: [] };
  }
  if (normalized === "default" || normalized.startsWith("auto/") || normalized.startsWith("auto")) {
    return { family: "cursor", portable: false, preferredProviders: [] };
  }
  if (CURSOR_PROPRIETARY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return { family: "cursor", portable: false, preferredProviders: [] };
  }
  if (normalized.includes("claude")) {
    return { family: "claude", portable: true, preferredProviders: ["claude"] };
  }
  if (
    normalized.includes("gpt") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.includes("codex")
  ) {
    return { family: "codex", portable: true, preferredProviders: ["codex", "opencode"] };
  }
  if (normalized.includes("gemini")) {
    return { family: "gemini", portable: true, preferredProviders: ["antigravity", "opencode"] };
  }
  if (normalized.includes("grok")) {
    return { family: "grok", portable: true, preferredProviders: ["opencode", "kilo", "cline"] };
  }
  return { family: "unknown", portable: false, preferredProviders: [] };
}

/** First provider from the suggestion that this host actually exposes. */
export function pickAvailableContinuationProvider(
  suggestion: CursorModelSuggestion,
  availableProviders: ReadonlySet<string>,
): string | null {
  return suggestion.preferredProviders.find((provider) => availableProviders.has(provider)) ?? null;
}
