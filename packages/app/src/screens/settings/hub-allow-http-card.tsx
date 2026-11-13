import { useCallback } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

export function HubAllowHttpSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "hubAllowHttpSetting");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const result = await patchConfig({ hubAllowHttp: next });
      if (!result) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return result;
    },
  });

  const handleValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(next);
    },
    [mutation],
  );

  if (!isConnected || !isSupported || !config) return null;

  return (
    <SettingsSection title={t("settings.host.hub.title")}>
      <View style={settingsStyles.card} testID="host-page-hub-allow-http-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.titleRow}>
              <Text style={settingsStyles.rowTitle}>{t("settings.host.hub.allowHttp.title")}</Text>
              <SettingsInfoTip
                title={t("settings.host.hub.allowHttp.title")}
                info={t("settings.host.hub.allowHttp.info")}
              />
            </View>
            <Text style={settingsStyles.rowHint}>{t("settings.host.hub.allowHttp.hint")}</Text>
            {mutation.error ? (
              <Text style={settingsStyles.rowError} testID="host-page-hub-allow-http-error">
                {mutation.error.message}
              </Text>
            ) : null}
          </View>
          <Switch
            value={config.hubAllowHttp === true}
            onValueChange={handleValueChange}
            disabled={mutation.isPending}
            accessibilityLabel={t("settings.host.hub.allowHttp.title")}
            testID="host-page-hub-allow-http-switch"
          />
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
