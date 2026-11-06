import { FileDiff, Files, Globe, Terminal } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { WindowChromeSafeArea } from "@/utils/desktop-window";
import type { ActivityRailEntryId } from "@/screens/workspace/workspace-chrome-model";
import type { Theme } from "@/styles/theme";

const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedFiles = withUnistyles(Files);
const ThemedGlobe = withUnistyles(Globe);
const ThemedTerminal = withUnistyles(Terminal);
const mutedRailIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedRailIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

const RAIL_ICONS = {
  changes: ThemedFileDiff,
  browser: ThemedGlobe,
  terminal: ThemedTerminal,
  files: ThemedFiles,
} as const;

interface WorkspaceActivityRailProps {
  contextLabel: string | null;
  entries: readonly ActivityRailEntryId[];
  activeEntry: ActivityRailEntryId | null;
  onActivate: (entry: ActivityRailEntryId) => void;
}

/**
 * Narrow right edge. Each entry opens a view the workspace already has:
 * Changes and Files through the explorer, Browser and Terminal through their tabs.
 */
export function WorkspaceActivityRail({
  contextLabel,
  entries,
  activeEntry,
  onActivate,
}: WorkspaceActivityRailProps) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  const labels: Record<ActivityRailEntryId, string> = {
    changes: t("panels.diff.changesLabel"),
    browser: t("workspace.tabs.fallback.browser"),
    terminal: t("workspace.tabs.fallback.terminal"),
    files: t("panels.files.label"),
  };
  return (
    <View style={styles.rail} testID="workspace-activity-rail">
      <WindowChromeSafeArea placement="below" />
      {contextLabel ? (
        <Text style={styles.context} numberOfLines={3} testID="workspace-activity-rail-context">
          {contextLabel}
        </Text>
      ) : null}
      <View style={styles.entries}>
        {entries.map((entry) => (
          <ActivityRailEntryButton
            key={entry}
            entry={entry}
            label={labels[entry]}
            active={entry === activeEntry}
            onActivate={onActivate}
          />
        ))}
      </View>
    </View>
  );
}

function ActivityRailEntryButton({
  entry,
  label,
  active,
  onActivate,
}: {
  entry: ActivityRailEntryId;
  label: string;
  active: boolean;
  onActivate: (entry: ActivityRailEntryId) => void;
}) {
  const Icon = RAIL_ICONS[entry];
  const handlePress = useCallback(() => onActivate(entry), [entry, onActivate]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.entry,
      (hovered || pressed) && !active ? styles.entryHovered : null,
      active ? styles.entryActive : null,
    ],
    [active],
  );
  return (
    <PressHighlight
      testID={`workspace-activity-rail-${entry}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={pressableStyle}
    >
      <Icon size={16} strokeWidth={1.5} uniProps={active ? mutedRailIcon : extraMutedRailIcon} />
      <Text style={[styles.entryLabel, active ? styles.entryLabelActive : null]} numberOfLines={2}>
        {label}
      </Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    width: 72,
    flexShrink: 0,
    alignSelf: "stretch",
    backgroundColor: theme.colors.surfaceSidebar,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  context: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize["2xs"],
    lineHeight: 13,
    textAlign: "center",
    paddingHorizontal: theme.spacing[1],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    userSelect: "none",
  },
  entries: {
    gap: theme.spacing[0.5],
  },
  entry: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[0.5],
    marginHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[0.5],
    borderRadius: theme.borderRadius.md,
  },
  entryHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  entryActive: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  entryLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize["2xs"],
    lineHeight: 12,
    textAlign: "center",
    userSelect: "none",
  },
  entryLabelActive: {
    color: theme.colors.foregroundMuted,
  },
}));
