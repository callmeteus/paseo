import type { AgentSessionConfig, AgentSlashCommand } from "./agent-sdk-types.js";

/** Cached draft slash-command lists stay warm across composer tabs and retries. */
export const DRAFT_COMMANDS_CACHE_TTL_MS = 5 * 60 * 1000;

/** After a failed listing, avoid spawning another provider probe for this long. */
export const DRAFT_COMMANDS_FAILURE_BACKOFF_MS = 60 * 1000;

export interface DraftCommandsCacheEntry {
  expiresAt: number;
  commands?: readonly AgentSlashCommand[];
  error?: unknown;
}

export function draftCommandsCacheKey(config: AgentSessionConfig): string {
  return JSON.stringify({
    provider: config.provider,
    cwd: config.cwd,
    modeId: config.modeId ?? null,
    model: config.model ?? null,
    thinkingOptionId: config.thinkingOptionId ?? null,
    title: config.title ?? null,
  });
}

export function readDraftCommandsCache(
  cache: Map<string, DraftCommandsCacheEntry>,
  key: string,
  now: number,
): DraftCommandsCacheEntry | null {
  const entry = cache.get(key);
  if (!entry || now >= entry.expiresAt) {
    if (entry) {
      cache.delete(key);
    }
    return null;
  }
  return entry;
}
