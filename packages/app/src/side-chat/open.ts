import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { showExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";
import { sideChatDraftId, sideChatDraftKey } from "./draft-key";

/**
 * Reveals the side chat as an ordinary tab in the Explorer sidebar. It is a real
 * agent draft, so it keeps the normal composer, transcript and model controls.
 */
export function openSideChat(input: {
  serverId: string;
  workspaceId: string;
  isCompact: boolean;
  draftText?: string;
}): string | null {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return null;
  }
  const paneId = showExplorerSidebar({ isCompact: input.isCompact, workspaceKey });
  const draftKey = sideChatDraftKey(input.serverId, input.workspaceId);
  const argument = input.draftText?.trim();
  if (argument) {
    const current = useDraftStore.getState().getDraftInput(draftKey)?.text.trim() ?? "";
    useDraftStore
      .getState()
      .editDraftText({ draftKey, text: current ? `${current}\n${argument}` : argument });
  }
  return useWorkspaceLayoutStore.getState().openTab({
    workspaceKey,
    target: { kind: "draft", draftId: sideChatDraftId(input.workspaceId) },
    intent: "reveal",
    placement: paneId ? { mode: "pane", paneId } : undefined,
  });
}
