import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  IdleRuntimeCleanupAfter,
  MutableDaemonConfigPatch,
} from "@getpaseo/protocol/messages";
import { SettingsCard, SettingsSelect } from "@/components/settings";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

// Host-wide, persisted, and applied live by the daemon.
export function IdleRuntimeCleanupCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "idleRuntimeCleanupSetting");
  const durationSupported = useHostFeature(serverId, "idleRuntimeCleanupAfterSetting");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const mutation = useMutation({
    mutationFn: async (patch: MutableDaemonConfigPatch) => {
      const result = await patchConfig(patch);
      if (!result) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return result;
    },
  });
  const afterOptions = useMemo(
    (): Array<{ value: IdleRuntimeCleanupAfter; label: string }> => [
      { value: "15m", label: t("settings.host.agents.idleRuntimeCleanup.after.15m") },
      { value: "30m", label: t("settings.host.agents.idleRuntimeCleanup.after.30m") },
      { value: "1h", label: t("settings.host.agents.idleRuntimeCleanup.after.1h") },
      { value: "2h", label: t("settings.host.agents.idleRuntimeCleanup.after.2h") },
      { value: "4h", label: t("settings.host.agents.idleRuntimeCleanup.after.4h") },
      { value: "8h", label: t("settings.host.agents.idleRuntimeCleanup.after.8h") },
      { value: "24h", label: t("settings.host.agents.idleRuntimeCleanup.after.24h") },
    ],
    [t],
  );

  const handleValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate({ idleRuntimeCleanup: next });
    },
    [mutation],
  );
  const handleAfterChange = useCallback(
    (next: string) => {
      const period = afterOptions.find((option) => option.value === next);
      if (!period) return;
      mutation.mutate({ idleRuntimeCleanupAfter: period.value });
    },
    [afterOptions, mutation],
  );

  if (!isConnected || !isSupported || !config) return null;

  return (
    <SettingsCard testID="host-page-idle-runtime-cleanup-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <View style={styles.titleRow}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.agents.idleRuntimeCleanup.title")}
            </Text>
            <SettingsInfoTip
              title={t("settings.host.agents.idleRuntimeCleanup.title")}
              info={t("settings.host.agents.idleRuntimeCleanup.info")}
            />
          </View>
          <Text style={settingsStyles.rowHint}>
            {t(
              durationSupported
                ? "settings.host.agents.idleRuntimeCleanup.hintChosen"
                : "settings.host.agents.idleRuntimeCleanup.hint",
            )}
          </Text>
          {mutation.error ? (
            <Text style={settingsStyles.rowError} testID="host-page-idle-runtime-cleanup-error">
              {mutation.error.message}
            </Text>
          ) : null}
        </View>
        <Switch
          value={config.idleRuntimeCleanup !== false}
          onValueChange={handleValueChange}
          disabled={mutation.isPending}
          accessibilityLabel={t("settings.host.agents.idleRuntimeCleanup.title")}
          testID="host-page-idle-runtime-cleanup-switch"
        />
      </View>
      {durationSupported ? (
        <SettingsSelect
          label={t("settings.host.agents.idleRuntimeCleanup.after.label")}
          value={config.idleRuntimeCleanupAfter ?? "1h"}
          options={afterOptions}
          onValueChange={handleAfterChange}
          disabled={mutation.isPending}
          testID="host-page-idle-runtime-cleanup-after"
        />
      ) : null}
    </SettingsCard>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
