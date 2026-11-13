import { userAttachmentsOnly } from "@/attachments/workspace-attachment-utils";
import { usePendingComposerSendStore } from "@/composer/pending-send";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";

/**
 * Puts a prompt the provider rejected back in the composer. The daemon already
 * removed it from the timeline; this reuses the exact text and attachments the
 * user sent so a retry or a model switch costs no retyping.
 */
export function restoreDroppedPrompt(input: {
  serverId: string;
  agentId: string;
  clientMessageId: string;
  text: string;
}): void {
  const draftKey = buildDraftStoreKey({ serverId: input.serverId, agentId: input.agentId });
  const pending = usePendingComposerSendStore.getState().take(input);
  const existing = useDraftStore.getState().getDraftInput(draftKey);
  if (existing && (existing.text.trim().length > 0 || existing.attachments.length > 0)) {
    return;
  }
  useDraftStore.getState().saveDraftInput({
    draftKey,
    draft: {
      text: pending?.text ?? input.text,
      attachments: pending ? userAttachmentsOnly(pending.attachments) : [],
    },
  });
}
