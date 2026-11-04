import type { FileMentionRange } from "./file-mention-autocomplete";

export interface ChatMentionCandidate {
  serverId: string;
  agentId: string;
  title: string | null;
  cwd: string;
  /** Set when the chat is archived; archived chats still match but rank after live ones. */
  archived: boolean;
  /** Epoch milliseconds of the most recent activity. */
  lastActivity: number;
  /** First matching excerpt, when the search matched message text instead of the title. */
  snippet?: string;
}

interface FilterAndRankChatMentionsInput {
  chats: readonly ChatMentionCandidate[];
  query: string;
  /** The chat being composed in. Referencing yourself is never useful. */
  excludeAgentId?: string | null;
  limit?: number;
}

interface RemoveMentionTokenInput {
  text: string;
  mention: FileMentionRange;
}

const DEFAULT_LIMIT = 5;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function rankByTitle(title: string | null, query: string): 0 | 1 | 2 {
  if (!title || !query) return 0;
  const normalizedTitle = normalize(title);
  if (normalizedTitle.startsWith(query)) return 2;
  if (normalizedTitle.includes(query)) return 1;
  return 0;
}

/**
 * Chat rows for the `@` picker. With an empty query this is the recent-chat list;
 * with a query, title matches rank above content-only matches.
 */
export function filterAndRankChatMentions(
  input: FilterAndRankChatMentionsInput,
): ChatMentionCandidate[] {
  const query = normalize(input.query);
  const excludeAgentId = input.excludeAgentId ?? null;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const seen = new Set<string>();
  const ranked: Array<{ chat: ChatMentionCandidate; score: number }> = [];

  for (const chat of input.chats) {
    if (chat.agentId === excludeAgentId) continue;
    const key = `${chat.serverId}:${chat.agentId}`;
    if (seen.has(key)) continue;
    const titleRank = rankByTitle(chat.title, query);
    if (query && titleRank === 0 && !chat.snippet) continue;
    seen.add(key);
    ranked.push({
      chat,
      score: (titleRank > 0 ? 10 : 0) + (chat.archived ? 0 : 1),
    });
  }

  ranked.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    return right.chat.lastActivity - left.chat.lastActivity;
  });

  return ranked.slice(0, limit).map((entry) => entry.chat);
}

/** Selecting a chat attaches its history, so the typed token disappears entirely. */
export function removeMentionToken(input: RemoveMentionTokenInput): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${after}`;
}
