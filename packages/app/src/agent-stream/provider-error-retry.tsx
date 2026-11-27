import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { generateMessageId } from "@/types/stream";

/**
 * Re-sends the prompt the provider rejected. The daemon normally drops that turn and the
 * composer restores its text, so the draft is the preferred retry payload. The prompt is
 * also present in the transcript, so keep the button available with that text as a fallback:
 * a failed turn whose dropped-prompt event never reached the app used to leave the error
 * card with no visible retry, and the user had to type something to make it appear.
 */
export function ProviderErrorRetry({
  serverId,
  agentId,
  fallbackText,
}: {
  serverId: string;
  agentId: string;
  fallbackText?: string;
}) {
  const { t } = useTranslation();
  const [isRetrying, setIsRetrying] = useState(false);
  const draftKey = buildDraftStoreKey({ serverId, agentId });
  const draftText = useDraftStore((state) => {
    const text = state.getDraftInput(draftKey)?.text;
    return typeof text === "string" && text.trim().length > 0 ? text : undefined;
  });
  const retryText = draftText ?? (fallbackText?.trim() ? fallbackText : undefined);

  const handleRetry = useCallback(() => {
    const text =
      useDraftStore.getState().getDraftInput(draftKey)?.text?.trim() || fallbackText?.trim();
    if (!text) return;
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    setIsRetrying(true);
    void (async () => {
      try {
        await client.sendAgentMessage(agentId, text, { messageId: generateMessageId() });
        useDraftStore.getState().clearDraftInput({ draftKey });
      } catch (error) {
        console.warn("[ProviderErrorRetry] failed to resend the prompt", error);
      } finally {
        setIsRetrying(false);
      }
    })();
  }, [agentId, draftKey, fallbackText, serverId]);

  return (
    <Button
      variant="outline"
      size="sm"
      testID="provider-error-retry"
      disabled={isRetrying || !retryText}
      onPress={handleRetry}
    >
      {t("common.actions.retry")}
    </Button>
  );
}
