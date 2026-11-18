import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { hostExclusionList, hostIsAnnounced, hostSyncsName } from "@/hosts/cluster-membership";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSettings, type ClusterPreferences } from "@/hooks/use-settings";
import { getHostRuntimeStore, useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { StyleSheet } from "react-native-unistyles";
import { Network } from "lucide-react-native";
import { HostStatusDot } from "@/components/host-status-dot";
import type { HostProfile } from "@/types/host-connection";

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

function ClusterHostToggle({
  title,
  accessibilityLabel,
  value,
  onChange,
  testID,
}: {
  title: string;
  accessibilityLabel: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testID: string;
}) {
  const handleValueChange = useCallback((next: boolean) => onChange(next), [onChange]);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={handleValueChange}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
    </View>
  );
}

function ClusterHostRow({
  host,
  divided,
  showSync,
  showAnnounce,
  syncsName,
  announced,
  onSyncChange,
  onAnnounceChange,
}: {
  host: HostProfile;
  divided: boolean;
  showSync: boolean;
  showAnnounce: boolean;
  syncsName: boolean;
  announced: boolean;
  onSyncChange: (serverId: string, include: boolean) => void;
  onAnnounceChange: (serverId: string, include: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = host.label?.trim() || host.serverId;
  const onSync = useCallback(
    (next: boolean) => onSyncChange(host.serverId, next),
    [host.serverId, onSyncChange],
  );
  const onAnnounce = useCallback(
    (next: boolean) => onAnnounceChange(host.serverId, next),
    [host.serverId, onAnnounceChange],
  );
  return (
    <View style={divided ? settingsStyles.rowBorder : undefined}>
      <View style={styles.hostRow}>
        <Network size={ICON_SIZE.md} color={styles.hostIcon.color} />
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {label}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {host.serverId}
          </Text>
        </View>
        <HostStatusDot serverId={host.serverId} />
      </View>
      {showSync ? (
        <ClusterHostToggle
          title={t("settings.cluster.hostSyncName")}
          accessibilityLabel={t("settings.cluster.hostSyncNameA11y", { host: label })}
          value={syncsName}
          onChange={onSync}
          testID={`cluster-host-sync-${host.serverId}`}
        />
      ) : null}
      {showAnnounce ? (
        <ClusterHostToggle
          title={t("settings.cluster.hostAnnounce")}
          accessibilityLabel={t("settings.cluster.hostAnnounceA11y", { host: label })}
          value={announced}
          onChange={onAnnounce}
          testID={`cluster-host-announce-${host.serverId}`}
        />
      ) : null}
    </View>
  );
}

export function ClusterSection({ serverId }: ClusterSectionProps) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { settings, updateSettings } = useSettings();
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const { config, patchConfig } = useDaemonConfig(serverId ?? "");
  const cluster = settings.cluster;

  const saveCluster = useCallback(
    (next: ClusterPreferences, mirror: boolean) => {
      void updateSettings({ cluster: next }).then(() => {
        if (mirror) getHostRuntimeStore().refreshClusterMirror();
        return undefined;
      });
    },
    [updateSettings],
  );

  const onAutoSyncChange = useCallback(
    (next: boolean) => {
      saveCluster({ ...cluster, autoSyncNames: next }, false);
      if (serverId) void patchConfig({ cluster: { syncHostNames: next } });
    },
    [saveCluster, cluster, serverId, patchConfig],
  );
  const onAnnounceChange = useCallback(
    (next: boolean) => {
      saveCluster({ ...cluster, announceHosts: next }, true);
      if (serverId) void patchConfig({ cluster: { announceHosts: next } });
    },
    [saveCluster, cluster, serverId, patchConfig],
  );
  const onHostSyncChange = useCallback(
    (hostId: string, include: boolean) => {
      saveCluster(
        {
          ...cluster,
          syncExcluded: hostExclusionList(cluster.syncExcluded, { serverId: hostId, include }),
        },
        false,
      );
    },
    [saveCluster, cluster],
  );
  const onHostAnnounceChange = useCallback(
    (hostId: string, include: boolean) => {
      saveCluster(
        {
          ...cluster,
          announceExcluded: hostExclusionList(cluster.announceExcluded, {
            serverId: hostId,
            include,
          }),
        },
        true,
      );
    },
    [saveCluster, cluster],
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
          value={cluster.autoSyncNames}
          onChange={onAutoSyncChange}
          testID="cluster-auto-sync-names-card"
        />
        <ClusterToggleCard
          title={t("settings.cluster.announceHostsTitle")}
          hint={t("settings.cluster.announceHostsHint")}
          value={cluster.announceHosts}
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
              <ClusterHostRow
                key={host.serverId}
                host={host}
                divided={index > 0}
                showSync={cluster.autoSyncNames}
                showAnnounce={cluster.announceHosts}
                syncsName={hostSyncsName(cluster, host.serverId)}
                announced={hostIsAnnounced(cluster, host.serverId)}
                onSyncChange={onHostSyncChange}
                onAnnounceChange={onHostAnnounceChange}
              />
            ))}
          </View>
        )}
      </SettingsSection>
    </>
  );
}
