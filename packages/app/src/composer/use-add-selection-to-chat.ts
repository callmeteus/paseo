import { useCallback, useMemo } from "react";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";

/** Adds a text selection from anywhere in the workspace to the focused chat. */
export function useAddSelectionToChat(input: { serverId: string; workspaceId?: string | null }) {
  const workspaceKey = input.workspaceId
    ? buildWorkspaceTabPersistenceKey({
        serverId: input.serverId,
        workspaceId: input.workspaceId,
      })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const focusedChat = useMemo(
    () => resolveFocusedChatTarget({ serverId: input.serverId, layout }),
    [input.serverId, layout],
  );
  const addSelection = useCallback(
    async (text: string) => {
      if (!focusedChat || !workspaceKey) {
        return;
      }
      await useDraftStore.getState().attachQuote({ draftKey: focusedChat.draftKey, text });
      revealWorkspaceTab(workspaceKey, focusedChat.tabId);
    },
    [focusedChat, workspaceKey],
  );
  return { addSelection, canAddSelection: focusedChat !== null };
}
