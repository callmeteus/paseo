import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { generateMessageId } from "@/types/stream";

/**
 * Re-sends the prompt the provider rejected. The daemon drops that turn and the
 * composer restores its text, so the draft is the retry payload. The button is
 * hidden when there is nothing restored to send.
 */
export function ProviderErrorRetry({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const [isRetrying, setIsRetrying] = useState(false);
  const draftKey = buildDraftStoreKey({ serverId, agentId });
  const hasPrompt = useDraftStore((state) => {
    const text = state.getDraftInput(draftKey)?.text;
    return typeof text === "string" && text.trim().length > 0;
  });

  const handleRetry = useCallback(() => {
    const text = useDraftStore.getState().getDraftInput(draftKey)?.text;
    if (!text || !text.trim()) return;
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
  }, [agentId, draftKey, serverId]);

  if (!hasPrompt) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      testID="provider-error-retry"
      disabled={isRetrying}
      onPress={handleRetry}
    >
      {t("common.actions.retry")}
    </Button>
  );
}
