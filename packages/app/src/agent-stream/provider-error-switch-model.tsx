import { useCallback } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useModelPickerRequestStore } from "@/composer/model-picker-request-store";

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
    request(agentId);
  }, [agentId, request]);

  return (
    <PressHighlight
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t("agentStream.providerError.switchModel")}
      testID="provider-error-switch-model"
      style={styles.button}
    >
      <Text style={styles.label}>{t("agentStream.providerError.switchModel")}</Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    alignSelf: "flex-start",
    marginTop: theme.spacing[1],
  },
  label: {
    color: "#f59e0b",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
}));
