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
  variant?: "rail" | "canvas";
  contextLabel: string | null;
  entries: readonly ActivityRailEntryId[];
  activeEntry: ActivityRailEntryId | null;
  onActivate: (entry: ActivityRailEntryId) => void;
}

/**
 * The four destinations the workspace already opens. `rail` is the side column used
 * when the left sidebar is closed and no file view is open. `canvas` is the large grid
 * shown only when that sidebar is open and has no conversation.
 */
export function WorkspaceActivityRail({
  variant = "rail",
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
  if (variant === "canvas") {
    return (
      <View style={styles.canvas} testID="workspace-activity-canvas">
        <View style={styles.canvasGrid}>
          {entries.map((entry) => (
            <ActivityCanvasEntryButton
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
  return (
    <View style={styles.rail} testID="workspace-activity-rail">
      <WindowChromeSafeArea placement="below" />
      {contextLabel ? (
        <Text style={styles.context} numberOfLines={1} testID="workspace-activity-rail-context">
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
      <Text style={[styles.entryLabel, active ? styles.entryLabelActive : null]} numberOfLines={1}>
        {label}
      </Text>
    </PressHighlight>
  );
}

function ActivityCanvasEntryButton({
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
      styles.canvasEntry,
      (hovered || pressed) && !active ? styles.canvasEntryHovered : null,
      active ? styles.canvasEntryActive : null,
    ],
    [active],
  );
  return (
    <PressHighlight
      testID={`workspace-activity-canvas-${entry}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={pressableStyle}
    >
      <Icon size={22} strokeWidth={1.5} uniProps={active ? mutedRailIcon : extraMutedRailIcon} />
      <Text
        style={[styles.canvasEntryLabel, active ? styles.entryLabelActive : null]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    width: 220,
    flexShrink: 0,
    alignSelf: "stretch",
    backgroundColor: theme.colors.surfaceSidebar,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  context: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
    textAlign: "left",
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    userSelect: "none",
  },
  entries: {
    gap: theme.spacing[0.5],
    paddingHorizontal: theme.spacing[2],
  },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  entryHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  entryActive: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  entryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    textAlign: "left",
    userSelect: "none",
  },
  entryLabelActive: {
    color: theme.colors.foregroundMuted,
  },
  canvas: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  canvasGrid: {
    width: "100%",
    maxWidth: 340,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
  },
  canvasEntry: {
    width: "48%",
    height: 108,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  canvasEntryHovered: {
    backgroundColor: theme.colors.surface2,
  },
  canvasEntryActive: {
    backgroundColor: theme.colors.surface2,
  },
  canvasEntryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 18,
    textAlign: "center",
    userSelect: "none",
  },
}));
