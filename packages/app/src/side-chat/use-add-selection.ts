import { useCallback, useMemo } from "react";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useHostFeature } from "@/runtime/host-features";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { sideChatDraftKey } from "./draft-key";
import { useSideChatStore } from "./store";

/** Quotes a selection into a known agent's side chat. Returns nothing when the host lacks the feature. */
export function useDraftAgentSideSelection(
  serverId: string,
  agentId: string | null,
): ((text: string) => void) | undefined {
  const sideChatEnabled = useHostFeature(serverId, "agentSideQuestion");
  const addSelection = useCallback(
    (text: string) => {
      if (!agentId) return;
      void useDraftStore.getState().attachQuote({
        draftKey: sideChatDraftKey(serverId, agentId),
        text,
      });
      useSideChatStore.getState().requestFocus(agentId);
    },
    [agentId, serverId],
  );
  if (!sideChatEnabled || agentId === null) return undefined;
  return addSelection;
}

export function sideAgentId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("id" in value)) return null;
  const id = value.id;
  return typeof id === "string" ? id : null;
}

/** Quotes a selection into the focused agent's side chat and opens that panel. */
export function useAddSelectionToSideChat(input: {
  serverId: string;
  workspaceId?: string | null;
}) {
  const sideChatEnabled = useHostFeature(input.serverId, "agentSideQuestion");
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
  const agentId = focusedChat?.agentId ?? null;
  const addSelection = useCallback(
    async (text: string) => {
      if (!agentId) return;
      await useDraftStore.getState().attachQuote({
        draftKey: sideChatDraftKey(input.serverId, agentId),
        text,
      });
      useSideChatStore.getState().requestFocus(agentId);
    },
    [agentId, input.serverId],
  );
  return {
    addSelection,
    canAddSelection: sideChatEnabled && agentId !== null,
  };
}
