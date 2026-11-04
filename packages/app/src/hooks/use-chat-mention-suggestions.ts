import { useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import {
  filterAndRankChatMentions,
  type ChatMentionCandidate,
} from "@/utils/chat-mention-autocomplete";
import { useAggregatedAgents } from "./use-aggregated-agents";

interface UseChatMentionSuggestionsInput {
  serverId: string;
  agentId: string;
  /** The `@` picker is open, so recents and the search are worth computing. */
  enabled: boolean;
  query: string;
  client: DaemonClient | null;
  isConnected: boolean;
  /** Host advertises both chat search and the fork-context RPC the attachment needs. */
  supportsChatMention: boolean;
  limit?: number;
}

const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Chat rows for the `@` picker: recent chats for an empty query, and daemon
 * search results (title plus message text) once the query is worth a roundtrip.
 */
export function useChatMentionSuggestions(
  input: UseChatMentionSuggestionsInput,
): ChatMentionCandidate[] {
  const { serverId, agentId, enabled, query, client, isConnected, supportsChatMention } = input;
  const normalizedQuery = query.trim();
  const aggregatedAgents = useAggregatedAgents({ demand: enabled });

  const searchQuery = useFetchQuery({
    queryKey: ["chatMentionSearch", serverId, normalizedQuery],
    dataShape: "list",
    staleTimeMs: 30_000,
    queryFn: async (): Promise<ChatMentionCandidate[]> => {
      if (!client) return [];
      const response = await client.searchChats({
        query: normalizedQuery,
        includeArchived: true,
        limit: input.limit ?? 5,
      });
      return response.chats.map((chat) => ({
        serverId,
        agentId: chat.agentId,
        title: chat.title,
        cwd: chat.cwd,
        archived: chat.archivedAt !== null,
        lastActivity: Date.parse(chat.updatedAt) || 0,
        snippet: chat.matches[0]?.snippet,
      }));
    },
    enabled:
      enabled &&
      supportsChatMention &&
      client !== null &&
      isConnected &&
      normalizedQuery.length >= MIN_SEARCH_QUERY_LENGTH,
    retry: false,
  });

  return useMemo(() => {
    if (!enabled) return [];
    const recents: ChatMentionCandidate[] = aggregatedAgents.agents
      .filter((agent) => agent.serverId === serverId)
      .map((agent) => ({
        serverId: agent.serverId,
        agentId: agent.id,
        title: agent.title,
        cwd: agent.cwd,
        archived: agent.archivedAt !== null,
        lastActivity: agent.lastActivityAt.getTime(),
      }));
    return filterAndRankChatMentions({
      chats: [...(searchQuery.data ?? []), ...recents],
      query,
      excludeAgentId: agentId,
      limit: input.limit ?? 5,
    });
  }, [aggregatedAgents.agents, agentId, enabled, input.limit, query, searchQuery.data, serverId]);
}
