import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSettings } from "@/hooks/use-settings";
import { useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { StyleSheet } from "react-native-unistyles";
import { Network } from "lucide-react-native";
import { HostStatusDot } from "@/components/host-status-dot";

const styles = StyleSheet.create((theme) => ({
  hostIcon: { color: theme.colors.foregroundMuted },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
}));

interface ClusterSectionProps {
  /** When set, shows the per-daemon flags for that host in addition to the device preferences. */
  serverId?: string;
}

function ClusterToggleCard({
  title,
  hint,
  value,
  onChange,
  testID,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testID: string;
}) {
  const handleValueChange = useCallback((next: boolean) => onChange(next), [onChange]);
  return (
    <View style={settingsStyles.card} testID={testID}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{title}</Text>
          <Text style={settingsStyles.rowHint}>{hint}</Text>
        </View>
        <Switch
          value={value}
          onValueChange={handleValueChange}
          accessibilityLabel={title}
          testID={`${testID}-switch`}
        />
      </View>
    </View>
  );
}

export function ClusterSection({ serverId }: ClusterSectionProps) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { settings, updateSettings } = useSettings();
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const { config, patchConfig } = useDaemonConfig(serverId ?? "");

  const onAutoSyncChange = useCallback(
    (next: boolean) => {
      void updateSettings({ cluster: { ...settings.cluster, autoSyncNames: next } });
      if (serverId) void patchConfig({ cluster: { syncHostNames: next } });
    },
    [updateSettings, settings.cluster, serverId, patchConfig],
  );
  const onAnnounceChange = useCallback(
    (next: boolean) => {
      void updateSettings({ cluster: { ...settings.cluster, announceHosts: next } });
      if (serverId) void patchConfig({ cluster: { announceHosts: next } });
    },
    [updateSettings, settings.cluster, serverId, patchConfig],
  );
  const onDaemonAnnounceChange = useCallback(
    (next: boolean) => void patchConfig({ cluster: { announceHosts: next } }),
    [patchConfig],
  );
  const onDaemonSyncChange = useCallback(
    (next: boolean) => void patchConfig({ cluster: { syncHostNames: next } }),
    [patchConfig],
  );

  return (
    <>
      <SettingsSection title={t("settings.cluster.title")}>
        <ClusterToggleCard
          title={t("settings.cluster.autoSyncNamesTitle")}
          hint={t("settings.cluster.autoSyncNamesHint")}
          value={settings.cluster.autoSyncNames}
          onChange={onAutoSyncChange}
          testID="cluster-auto-sync-names-card"
        />
        <ClusterToggleCard
          title={t("settings.cluster.announceHostsTitle")}
          hint={t("settings.cluster.announceHostsHint")}
          value={settings.cluster.announceHosts}
          onChange={onAnnounceChange}
          testID="cluster-announce-hosts-card"
        />
        {serverId && isConnected ? (
          <View style={settingsStyles.card} testID="cluster-daemon-config-card">
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.cluster.daemonConfigTitle")}
                </Text>
                <Text style={settingsStyles.rowHint}>{t("settings.cluster.daemonConfigHint")}</Text>
              </View>
            </View>
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.cluster.daemonAnnounceTitle")}
                </Text>
              </View>
              <Switch
                value={config?.cluster?.announceHosts === true}
                onValueChange={onDaemonAnnounceChange}
                accessibilityLabel={t("settings.cluster.daemonAnnounceTitle")}
                testID="cluster-daemon-announce-switch"
              />
            </View>
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.cluster.daemonSyncNamesTitle")}
                </Text>
              </View>
              <Switch
                value={config?.cluster?.syncHostNames === true}
                onValueChange={onDaemonSyncChange}
                accessibilityLabel={t("settings.cluster.daemonSyncNamesTitle")}
                testID="cluster-daemon-sync-switch"
              />
            </View>
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("settings.cluster.hostsTitle")}>
        {hosts.length === 0 ? (
          <View style={settingsStyles.card}>
            <Text style={settingsStyles.rowHint}>{t("settings.cluster.hostsEmpty")}</Text>
          </View>
        ) : (
          <View style={settingsStyles.card} testID="cluster-hosts-card">
            {hosts.map((host, index) => (
              <View
                key={host.serverId}
                style={[styles.hostRow, index > 0 ? settingsStyles.rowBorder : undefined]}
              >
                <Network size={ICON_SIZE.md} color={styles.hostIcon.color} />
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                    {host.label?.trim() || host.serverId}
                  </Text>
                  <Text style={settingsStyles.rowHint} numberOfLines={1}>
                    {host.serverId}
                  </Text>
                </View>
                <HostStatusDot serverId={host.serverId} />
              </View>
            ))}
          </View>
        )}
      </SettingsSection>
    </>
  );
}
