import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import { findChatTextMatches, type ChatTextMatch } from "./index.js";

export interface ChatSearchCandidate {
  agentId: string;
  title: string | null;
  provider: string;
  status: AgentLifecycleStatus;
  cwd: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ChatSearchEntry {
  seq: number;
  item: { type: string; text?: string };
}

export interface ChatSearchHit extends ChatSearchCandidate {
  titleMatch: boolean;
  matches: ChatTextMatch[];
}

export interface SearchChatsAcrossChatsInput {
  chats: readonly ChatSearchCandidate[];
  loadEntries: (agentId: string) => Promise<readonly ChatSearchEntry[]>;
  query: string;
  limit?: number;
  matchesPerChat?: number;
  /** Stop scanning and return what matched so far. Keeps typing responsive. */
  deadlineMs?: number;
  now?: () => number;
}

const DEFAULT_LIMIT = 8;
const DEFAULT_MATCHES_PER_CHAT = 2;
const DEFAULT_DEADLINE_MS = 250;
const CACHE_LIMIT = 200;

interface CachedEntries {
  updatedAt: string;
  entries: readonly ChatSearchEntry[];
}

// Discovery is typed-ahead search: the same chat is scored on every keystroke, and
// re-reading its stored timeline each time dominates the cost. Keyed by `updatedAt`
// so a chat that gained messages is rescanned exactly once.
const entriesCache = new Map<string, CachedEntries>();

function readCachedEntries(agentId: string, updatedAt: string): readonly ChatSearchEntry[] | null {
  const cached = entriesCache.get(agentId);
  if (!cached || cached.updatedAt !== updatedAt) {
    return null;
  }
  entriesCache.delete(agentId);
  entriesCache.set(agentId, cached);
  return cached.entries;
}

function writeCachedEntries(
  agentId: string,
  updatedAt: string,
  entries: readonly ChatSearchEntry[],
) {
  entriesCache.delete(agentId);
  entriesCache.set(agentId, { updatedAt, entries });
  while (entriesCache.size > CACHE_LIMIT) {
    const oldest = entriesCache.keys().next();
    if (oldest.done) break;
    entriesCache.delete(oldest.value);
  }
}

export function resetChatSearchCache(): void {
  entriesCache.clear();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function titleMatches(title: string | null, normalizedQuery: string): boolean {
  if (!title) return false;
  return normalizeText(title).includes(normalizedQuery);
}

/**
 * Scores every candidate against the query, returning chats in relevance order.
 *
 * Loading entries is the expensive part, so the scan is bounded by `deadlineMs`:
 * a slow first keystroke returns partial results instead of blocking the picker.
 * Only the daemon-local caller uses the cache; a client-backed caller still
 * benefits because the cache is keyed by immutable `updatedAt` snapshots.
 */
export async function searchChatsAcrossChats(
  input: SearchChatsAcrossChatsInput,
): Promise<ChatSearchHit[]> {
  const normalizedQuery = normalizeText(input.query);
  if (!normalizedQuery) return [];

  const limit = input.limit ?? DEFAULT_LIMIT;
  const matchesPerChat = input.matchesPerChat ?? DEFAULT_MATCHES_PER_CHAT;
  const now = input.now ?? Date.now;
  const deadline = now() + (input.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const hits: Array<ChatSearchHit & { rank: number }> = [];

  for (const [index, chat] of input.chats.entries()) {
    const isTitleMatch = titleMatches(chat.title, normalizedQuery);
    const cached = readCachedEntries(chat.agentId, chat.updatedAt);
    if (!cached && now() > deadline) break;
    let entries: readonly ChatSearchEntry[];
    if (cached) {
      entries = cached;
    } else {
      const loaded = await input.loadEntries(chat.agentId);
      writeCachedEntries(chat.agentId, chat.updatedAt, loaded);
      entries = loaded;
    }
    const matches = findChatTextMatches({
      items: entries,
      query: input.query,
      maxMatches: matchesPerChat,
    });
    if (!isTitleMatch && matches.length === 0) continue;
    hits.push({ ...chat, titleMatch: isTitleMatch, matches, rank: index });
    // Collect a few more than requested so relevance sorting can still promote a
    // title match found later in the recency-ordered candidate list.
    if (hits.length >= limit * 3) break;
  }

  hits.sort((left, right) => {
    if (left.titleMatch !== right.titleMatch) return left.titleMatch ? -1 : 1;
    if (left.matches.length !== right.matches.length)
      return right.matches.length - left.matches.length;
    return left.rank - right.rank;
  });
  return hits.slice(0, limit).map(({ rank: _rank, ...hit }) => hit);
}
