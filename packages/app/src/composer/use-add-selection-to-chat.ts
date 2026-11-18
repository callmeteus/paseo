import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { insertSelectionAsInlineChip } from "@/composer/selection-inline-chip";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";

/** Adds a text selection from anywhere in the workspace to the focused chat. */
export function useAddSelectionToChat(input: { serverId: string; workspaceId?: string | null }) {
  const { t } = useTranslation();
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
      await useDraftStore.getState().hydrateDraftInput({ draftKey: focusedChat.draftKey });
      const store = useDraftStore.getState();
      const current = store.getDraftInput(focusedChat.draftKey);
      const next = insertSelectionAsInlineChip({
        currentText: current?.text ?? "",
        selectionText: text,
        labels: {
          pastedWord: t("composer.inlineChip.pastedWord"),
          lineOne: t("composer.inlineChip.line_one"),
          lineOther: t("composer.inlineChip.line_other"),
        },
      });
      store.editDraftText({ draftKey: focusedChat.draftKey, text: next.text });
      store.requestTextReplacement({ draftKey: focusedChat.draftKey });
      revealWorkspaceTab(workspaceKey, focusedChat.tabId);
    },
    [focusedChat, workspaceKey, t],
  );
  return { addSelection, canAddSelection: focusedChat !== null };
}
