import { buildDraftStoreKey } from "@/stores/draft-keys";

export function sideChatDraftKey(serverId: string, agentId: string): string {
  return buildDraftStoreKey({ serverId, agentId, draftId: `side:${agentId}` });
}
