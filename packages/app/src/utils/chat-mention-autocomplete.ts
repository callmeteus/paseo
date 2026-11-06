import type { FileMentionRange } from "./file-mention-autocomplete";

export interface ChatMentionCandidate {
  serverId: string;
  agentId: string;
  title: string | null;
  /** Workspace display name; people often remember the workspace, not the title. */
  workspaceName?: string | null;
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

const TITLE_PREFIX_RANK = 3;
const TITLE_CONTAINS_RANK = 2;
const WORKSPACE_CONTAINS_RANK = 1;

function rankByTitle(title: string | null, query: string): number {
  if (!title || !query) return 0;
  const normalizedTitle = normalize(title);
  if (normalizedTitle.startsWith(query)) return TITLE_PREFIX_RANK;
  if (normalizedTitle.includes(query)) return TITLE_CONTAINS_RANK;
  return 0;
}

function rankByWorkspace(workspaceName: string | null | undefined, query: string): number {
  if (!workspaceName || !query) return 0;
  return normalize(workspaceName).includes(query) ? WORKSPACE_CONTAINS_RANK : 0;
}

/**
 * Chat rows for the `@` picker. With an empty query this is the recent-chat list;
 * with a query, name matches (chat title, then workspace) rank above content-only
 * matches.
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
    const nameRank = Math.max(
      rankByTitle(chat.title, query),
      rankByWorkspace(chat.workspaceName, query),
    );
    if (query && nameRank === 0 && !chat.snippet) continue;
    seen.add(key);
    ranked.push({
      chat,
      score: nameRank * 10 + (chat.archived ? 0 : 1),
    });
  }

  ranked.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    return right.chat.lastActivity - left.chat.lastActivity;
  });

  return ranked.slice(0, limit).map((entry) => entry.chat);
}

/** Deletes the `@` token the caret is in. The composer replaces that range with a mention chip. */
export function removeMentionToken(input: RemoveMentionTokenInput): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${after}`;
}
