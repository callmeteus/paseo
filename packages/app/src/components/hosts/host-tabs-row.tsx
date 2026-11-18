import { useCallback, useMemo, type ReactElement } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { Server } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { connectionLabelKey, HostStatusDot } from "@/components/host-status-dot";
import { StatusIcon } from "@/components/status-icon";
import { useTranslation } from "react-i18next";
import { useHostRuntimeConnectionStatus, useHostRuntimeLastError } from "@/runtime/host-runtime";
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

// A row tab's glyph is the same 14px the workspace tab rail uses. The 12px badge
// glyph is too small here: the status overlay covers the host icon completely.
const HOST_TAB_ICON_SIZE = 14;

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
      style={styles.scrollView}
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
  const { runningCount, dominantBucket } = useHostAgentSummary(host.serverId);
  const hostStatus = useHostRuntimeConnectionStatus(host.serverId);
  const lastError = useHostRuntimeLastError(host.serverId);
  const { t } = useTranslation();
  const connectionLabel = t(connectionLabelKey(hostStatus));
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
  const accessibilityLabel = `${label}, ${connectionLabel}, ${runningCount} ${runningCount === 1 ? "agent" : "agents"} running`;

  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
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
            size={HOST_TAB_ICON_SIZE}
            backdrop={active ? "surface2" : "surface0"}
          >
            <ThemedServer
              size={HOST_TAB_ICON_SIZE}
              strokeWidth={2.25}
              uniProps={SERVER_ICON_MAPPINGS[host.appearance.color]}
            />
          </StatusIcon>
          <HostStatusDot serverId={host.serverId} status={hostStatus} />
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
        </PressHighlight>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
        <Text style={styles.tooltipStatus}>
          {connectionLabel}
          {hostStatus === "error" && lastError ? ` — ${lastError}` : ""}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

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
  // A fixed height keeps the rail from stretching to fill the column it sits in.
  scrollView: {
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  // Tabs sit on the strip's bottom rule. Only the top corners are round, and
  // the selected one gets the underline — a pill would float above the rule.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: 28,
    maxWidth: 176,
    paddingHorizontal: theme.spacing[2],
    borderTopLeftRadius: theme.borderRadius.md,
    borderTopRightRadius: theme.borderRadius.md,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    backgroundColor: theme.colors.surface0,
  },
  chipActive: {
    backgroundColor: theme.colors.surface2,
    borderBottomColor: theme.colors.foreground,
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
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  tooltipStatus: {
    fontSize: theme.fontSize["2xs"],
    color: theme.colors.foregroundMuted,
  },
  // Reserved width so the chip does not move when a running agent appears.
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  countText: {
    fontSize: 11,
    lineHeight: 13,
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
