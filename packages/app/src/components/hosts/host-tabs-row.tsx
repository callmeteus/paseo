import { useCallback, useMemo, type ReactElement } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { CircleCheck, Server } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StatusIcon } from "@/components/status-icon";
import { HOST_BADGE_ICON_SIZE } from "@/hosts/host-badge";
import { HOST_COLORS, type HostColor } from "@/hosts/appearance";
import { identityForeground } from "@/styles/identity-colors";
import type { Theme } from "@/styles/theme";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostAgentSummary } from "@/hooks/use-host-agent-summary";
import type { HostProfile } from "@/types/host-connection";
import { normalizeHostLabel, orderHostsLocalFirst } from "@/types/host-connection";
import { useHosts } from "@/runtime/host-runtime";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

const ThemedServer = withUnistyles(Server);
const ThemedCircleCheck = withUnistyles(CircleCheck);

const noneMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * One stable mapping per host color for the life of the module — a fresh `uniProps`
 * identity on every render makes withUnistyles re-subscribe. Same palette host badges use.
 */
const SERVER_ICON_MAPPINGS: Record<HostColor, (theme: Theme) => { color: string }> = (() => {
  const byColor = {} as Record<HostColor, (theme: Theme) => { color: string }>;
  for (const color of HOST_COLORS) {
    byColor[color] =
      color === "none"
        ? noneMapping
        : (theme: Theme) => ({ color: identityForeground(color, theme.colorScheme) });
  }
  return byColor;
})();

export interface HostTabsRowProps {
  activeServerId: string | null;
  onSelectHost: (serverId: string) => void;
}

/**
 * The top rail that makes hosts navigable: one chip per host, with the count of
 * agents currently working there and the host's most urgent agent state.
 *
 * Shown only in the "hosts in top tabs" display mode and only when there is
 * more than one host to switch between.
 */
export function HostTabsRow({
  activeServerId,
  onSelectHost,
}: HostTabsRowProps): ReactElement | null {
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const orderedHosts = useMemo(
    () => orderHostsLocalFirst(hosts.slice(), localServerId),
    [hosts, localServerId],
  );

  if (orderedHosts.length <= 1) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      testID="host-tabs-row"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {orderedHosts.map((host) => (
        <HostTabChip
          key={host.serverId}
          host={host}
          active={host.serverId === activeServerId}
          onPress={onSelectHost}
        />
      ))}
    </ScrollView>
  );
}

function HostTabChip({
  host,
  active,
  onPress,
}: {
  host: HostProfile;
  active: boolean;
  onPress: (serverId: string) => void;
}): ReactElement {
  const { runningCount, dominantBucket, hasFinished } = useHostAgentSummary(host.serverId);
  const label = normalizeHostLabel(host.label, host.serverId);
  const handlePress = useCallback(() => onPress(host.serverId), [host.serverId, onPress]);
  const chipStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.chip,
      active ? styles.chipActive : null,
      hovered || pressed ? styles.chipHighlighted : null,
    ],
    [active],
  );
  const statusTextStyle = countTextStyle(dominantBucket);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const accessibilityLabel = `${label}, ${runningCount} ${runningCount === 1 ? "agent" : "agents"} running`;

  return (
    <PressHighlight
      testID={`host-tab-${host.serverId}`}
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={chipStyle}
    >
      <StatusIcon
        statusBucket={dominantBucket}
        size={HOST_BADGE_ICON_SIZE}
        backdrop={active ? "surface2" : "surface0"}
      >
        <ThemedServer
          size={HOST_BADGE_ICON_SIZE}
          uniProps={SERVER_ICON_MAPPINGS[host.appearance.color]}
        />
      </StatusIcon>
      <Text
        style={[styles.label, active ? styles.labelActive : null]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      <View style={[styles.countBadge, statusTextStyle.badge]}>
        <Text style={[styles.countText, statusTextStyle.text]}>{runningCount}</Text>
      </View>
      {hasFinished && dominantBucket === "attention" ? (
        <ThemedCircleCheck size={12} uniProps={finishedMapping} />
      ) : null}
    </PressHighlight>
  );
}

const finishedMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });

function countTextStyle(bucket: SidebarStateBucket | null): {
  badge: Record<string, unknown>;
  text: Record<string, unknown>;
} {
  switch (bucket) {
    case "needs_input":
      return { badge: styles.badgeWarning, text: styles.textWarning };
    case "failed":
      return { badge: styles.badgeDanger, text: styles.textDanger };
    case "attention":
      return { badge: styles.badgeSuccess, text: styles.textSuccess };
    case "running":
      return { badge: styles.badgeRunning, text: styles.textRunning };
    default:
      return { badge: styles.badgeMuted, text: styles.textMuted };
  }
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 28,
    maxWidth: 160,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
  },
  chipActive: {
    backgroundColor: theme.colors.surface2,
  },
  chipHighlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  label: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
  // Reserved width so the chip does not move when a running agent appears.
  countBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 2,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  countText: {
    fontSize: 10,
    lineHeight: 12,
    includeFontPadding: false,
    textAlign: "center",
    textAlignVertical: "center",
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  badgeWarning: { borderColor: theme.colors.statusWarning },
  textWarning: { color: theme.colors.statusWarning },
  badgeDanger: { borderColor: theme.colors.statusDanger },
  textDanger: { color: theme.colors.statusDanger },
  badgeSuccess: { borderColor: theme.colors.statusSuccess },
  textSuccess: { color: theme.colors.statusSuccess },
  badgeRunning: { borderColor: theme.colors.foreground },
  textRunning: { color: theme.colors.foreground },
  badgeMuted: { borderColor: theme.colors.foregroundMuted },
  textMuted: { color: theme.colors.foregroundMuted },
}));
