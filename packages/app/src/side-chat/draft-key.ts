import { buildDraftStoreKey } from "@/stores/draft-keys";

/** One side chat per workspace, so it survives across the agents you visit. */
export function sideChatDraftId(workspaceId: string): string {
  return `side:${workspaceId}`;
}

export function sideChatDraftKey(serverId: string, workspaceId: string): string {
  return buildDraftStoreKey({
    serverId,
    agentId: "side-chat",
    draftId: sideChatDraftId(workspaceId),
  });
}
