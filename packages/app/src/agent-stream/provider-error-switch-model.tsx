import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useModelPickerRequestStore } from "@/composer/model-picker-request-store";

/**
 * Opens the model picker from a provider error card. The pick commits the model
 * and re-sends the rejected prompt instead of staging it for the next message.
 */
export function ProviderErrorSwitchModel({
  agentId,
  disabled = false,
}: {
  agentId: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const request = useModelPickerRequestStore((state) => state.request);
  const onPress = useCallback(() => {
    request(agentId, { retryAfterPick: true });
  }, [agentId, request]);

  return (
    <Button
      variant="outline"
      size="sm"
      testID="provider-error-switch-model"
      disabled={disabled}
      onPress={onPress}
    >
      {t("agentStream.providerError.switchModel")}
    </Button>
  );
}
