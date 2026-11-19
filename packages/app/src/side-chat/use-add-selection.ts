import { useCallback } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useDraftStore } from "@/stores/draft-store";
import { openSideChat } from "./open";
import { sideChatDraftKey } from "./draft-key";

/** Quotes a selection into the workspace side chat and reveals its Explorer tab. */
export function useAddSelectionToSideChat(input: {
  serverId: string;
  workspaceId?: string | null;
}) {
  const isCompact = useIsCompactFormFactor();
  const workspaceId = input.workspaceId?.trim() || null;
  const addSelection = useCallback(
    (text: string) => {
      if (!workspaceId) return;
      void useDraftStore.getState().attachQuote({
        draftKey: sideChatDraftKey(input.serverId, workspaceId),
        text,
      });
      openSideChat({ serverId: input.serverId, workspaceId, isCompact });
    },
    [input.serverId, isCompact, workspaceId],
  );
  return {
    addSelection: workspaceId ? addSelection : undefined,
    canAddSelection: workspaceId !== null,
  };
}
