import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useAppVisible } from "@/hooks/use-app-visible";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import type { Theme } from "@/styles/theme";
import { useUsageDisplay } from "./display";
import { useUsageHostId } from "./hosts";
import { useUsageInSidebar } from "./in-sidebar";
import { UsageMeter } from "./meter";
import { PinnedUsageHover } from "./pinned-hover";
import {
  choosePinnedUsageLayout,
  METER_GAP,
  MIN_METER_WIDTH,
  resolvePinnedUsage,
  resolvePinnedUsageItems,
  type PinnedUsageItem,
  type PinnedUsageLayout,
  type PinnedUsageSource,
} from "./pinned";
import type { UsageDisplayAs } from "./preferences";
import { useUsageHostReports } from "./queries";
import { UsageSourceIcon } from "./source-icon";
import type { UsageReportEntry } from "./types";
import { UsageModal } from "./usage-modal";

const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const errorIconColor = (theme: Theme) => ({ color: theme.colors.statusDanger });

/**
 * The summary windows with data on the usage host, under their source, in card order. Empty while
 * none has data. Only the visible sidebar polls the host.
 */
export function useUsageSummary(): readonly PinnedUsageSource[] {
  const { t } = useTranslation();
  const active = useRetainedPanelActive();
  const isAppVisible = useAppVisible();
  const { inSidebar } = useUsageInSidebar();
  const serverId = useUsageHostId();
  const reports = useUsageHostReports({
    serverId: inSidebar ? serverId : null,
    shouldPoll: active && inSidebar && isAppVisible,
  });
  const { preferences } = useUsageDisplay(reports);
  return useMemo(() => resolvePinnedUsage(reports, preferences, t), [preferences, reports, t]);
}

/** Whether the sidebar Usage item has anything to show. */
export function useHasUsageSummary(): boolean {
  return useUsageSummary().length > 0;
}

/** Our unified line: each pinned unified summary and window, with the entry behind each hover. */
function useUsageSidebarItems(): {
  items: readonly PinnedUsageItem[];
  entries: ReadonlyMap<string, UsageReportEntry>;
  displayAs: UsageDisplayAs;
} {
  const { t } = useTranslation();
  const active = useRetainedPanelActive();
  const isAppVisible = useAppVisible();
  const { inSidebar } = useUsageInSidebar();
  const serverId = useUsageHostId();
  const reports = useUsageHostReports({
    serverId: inSidebar ? serverId : null,
    shouldPoll: active && inSidebar && isAppVisible,
  });
  const { preferences } = useUsageDisplay(reports);
  return useMemo(() => {
    const entries = new Map(reports.map((entry) => [entry.id, entry]));
    return {
      items: resolvePinnedUsageItems(reports, preferences, t),
      entries,
      displayAs: preferences.displayAs,
    };
  }, [preferences, reports, t]);
}

/**
 * The sidebar footer's usage entry: the pinned unified summaries and windows, and nothing
 * while no item is pinned. Pressing it opens the Usage modal.
 */
export function UsageSidebarItem({ sources }: { sources: readonly PinnedUsageSource[] }) {
  const { t } = useTranslation();
  const label = t(builtinSidebarNavLabelKey("usage"));
  const openUsage = useOpenSidebarUsage();
  const { items, entries, displayAs } = useUsageSidebarItems();
  if (items.length === 0) return null;
  return (
    <PinnedUsageTrigger
      label={label}
      items={items}
      entries={entries}
      displayAs={displayAs}
      sources={sources}
      errorLabel={t("providerUsage.refreshFailed")}
      unifiedLabel={t("providerUsage.unified.short")}
      onPress={openUsage}
    />
  );
}

const OpenSidebarUsageContext = createContext<(() => void) | null>(null);

/**
 * One owner for the footer icon and summary: both open the Usage modal over the current screen.
 * The modal mounts on first open and unmounts once it has finished closing, so its host's reports
 * load only while it is shown.
 */
export function UsageSidebarRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const openUsage = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);
  const closeUsage = useCallback(() => setOpen(false), []);
  const unmountUsage = useCallback(() => setMounted(false), []);

  return (
    <OpenSidebarUsageContext.Provider value={openUsage}>
      {children}
      {mounted ? <UsageModal visible={open} onClose={closeUsage} onDismiss={unmountUsage} /> : null}
    </OpenSidebarUsageContext.Provider>
  );
}

/** Both sidebar entry points send the same open command. */
export function useOpenSidebarUsage(): () => void {
  const openUsage = useContext(OpenSidebarUsageContext);
  if (!openUsage) throw new Error("Sidebar Usage must be inside UsageSidebarRoot.");
  return openUsage;
}

function pinnedUsageLabel(
  label: string,
  items: readonly PinnedUsageItem[],
  unifiedLabel: string,
  sources: readonly PinnedUsageSource[],
  errorLabel: string,
): string {
  const parts = items.map((item) =>
    item.kind === "unified" ? `${item.unified.driver.label} (${unifiedLabel})` : item.window.label,
  );
  const error = sources.some((source) => source.hasError) ? `, ${errorLabel}` : "";
  return `${label}: ${parts.join(", ")}${error}`;
}

function triggerStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

function layoutWidth(event: LayoutChangeEvent): number {
  return event.nativeEvent.layout.width;
}

/**
 * One line: each pinned provider's icon, then its unified meter and "69% Overall" or a
 * pinned window's meter and "31% 5h". Off-screen copies measure the line with labels and
 * with percents alone; the richest layout that fits is shown.
 */
function PinnedUsageTrigger({
  label,
  items,
  entries,
  displayAs,
  sources,
  errorLabel,
  unifiedLabel,
  onPress,
}: {
  label: string;
  items: readonly PinnedUsageItem[];
  entries: ReadonlyMap<string, UsageReportEntry>;
  displayAs: UsageDisplayAs;
  sources: readonly PinnedUsageSource[];
  errorLabel: string;
  unifiedLabel: string;
  onPress: () => void;
}) {
  const [available, setAvailable] = useState<number | null>(null);
  const [labelsWidth, setLabelsWidth] = useState<number | null>(null);
  const [compactWidth, setCompactWidth] = useState<number | null>(null);
  const [percentsWidth, setPercentsWidth] = useState<number | null>(null);
  const handleAvailableLayout = useCallback((event: LayoutChangeEvent) => {
    setAvailable(layoutWidth(event));
  }, []);
  const handleLabelsLayout = useCallback((event: LayoutChangeEvent) => {
    setLabelsWidth(layoutWidth(event));
  }, []);
  const handleCompactLayout = useCallback((event: LayoutChangeEvent) => {
    setCompactWidth(layoutWidth(event));
  }, []);
  const handlePercentsLayout = useCallback((event: LayoutChangeEvent) => {
    setPercentsWidth(layoutWidth(event));
  }, []);
  const layout = choosePinnedUsageLayout({
    available,
    labelsWidth,
    compactWidth,
    percentsWidth,
    windowCount: items.length,
  });
  return (
    <PressHighlight
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={pinnedUsageLabel(label, items, unifiedLabel, sources, errorLabel)}
      style={triggerStyle}
      highlightStyle={styles.triggerPressed}
      testID="sidebar-usage"
    >
      <View style={styles.line} onLayout={handleAvailableLayout}>
        <PinnedUsageLine
          items={items}
          layout={layout}
          entries={entries}
          displayAs={displayAs}
          sources={sources}
        />
      </View>
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View style={styles.measured} onLayout={handleLabelsLayout}>
          <PinnedUsageLine
            items={items}
            layout="labels"
            entries={entries}
            displayAs={displayAs}
            sources={sources}
            measuring
          />
        </View>
        <View style={styles.measured} onLayout={handleCompactLayout}>
          <PinnedUsageLine
            items={items}
            layout="compact"
            entries={entries}
            displayAs={displayAs}
            sources={sources}
            measuring
          />
        </View>
        <View style={styles.measured} onLayout={handlePercentsLayout}>
          <PinnedUsageLine
            items={items}
            layout="percents"
            entries={entries}
            displayAs={displayAs}
            sources={sources}
            measuring
          />
        </View>
      </View>
    </PressHighlight>
  );
}

function pinnedUsageTestID(measuring: boolean, kind: PinnedUsageItem["kind"]): string | undefined {
  if (measuring) return undefined;
  if (kind === "unified") return "sidebar-usage-unified";
  return "sidebar-usage-pinned-window";
}

/**
 * The line's items as direct children of one row, so every meter shares the leftover width
 * equally. The source icon appears once per provider group.
 */
function PinnedUsageLine({
  items,
  layout,
  entries,
  displayAs,
  sources,
  measuring = false,
}: {
  items: readonly PinnedUsageItem[];
  layout: PinnedUsageLayout;
  entries: ReadonlyMap<string, UsageReportEntry>;
  displayAs: UsageDisplayAs;
  sources: readonly PinnedUsageSource[];
  measuring?: boolean;
}) {
  return items.map((item, index) => (
    <PinnedUsageCluster
      key={item.key}
      item={item}
      index={index}
      previousSourceKey={index === 0 ? null : items[index - 1]!.sourceKey}
      layout={layout}
      entry={entries.get(item.sourceKey) ?? null}
      displayAs={displayAs}
      hasError={sources.some((source) => source.key === item.sourceKey && source.hasError)}
      measuring={measuring}
    />
  ));
}

function PinnedUsageCluster({
  item,
  index,
  previousSourceKey,
  layout,
  entry,
  displayAs,
  hasError,
  measuring,
}: {
  item: PinnedUsageItem;
  index: number;
  previousSourceKey: string | null;
  layout: PinnedUsageLayout;
  entry: UsageReportEntry | null;
  displayAs: UsageDisplayAs;
  hasError: boolean;
  measuring: boolean;
}) {
  const { t } = useTranslation();
  const startsSource = previousSourceKey !== item.sourceKey;
  const slotStyle = clusterStyle(startsSource, index, layout);
  const icon = item.kind === "unified" ? item.source.icon : item.window.icon;
  const percent = item.kind === "unified" ? item.unified.percent : item.window.percent;
  const percentText = item.kind === "unified" ? item.unified.percentText : item.window.percentText;
  const tone = item.kind === "unified" ? item.unified.tone : item.window.tone;
  const shortLabel =
    item.kind === "unified" ? t("providerUsage.unified.short") : item.window.shortLabel;
  // A narrow line keeps the bare period token ("5h", "wk") instead of dropping every label.
  const compactLabel = item.kind === "unified" ? "" : item.window.compactLabel;
  const suffix = layout === "compact" ? compactLabel : shortLabel;
  const leadStyle = startsSource ? styles.iconGap : null;
  const testID = pinnedUsageTestID(measuring, item.kind);
  const body = (
    <>
      {startsSource ? (
        <View testID={measuring ? undefined : "sidebar-usage-source"}>
          <View style={styles.source}>
            <UsageSourceIcon svg={icon} size={14} />
            {hasError ? (
              <ThemedTriangleAlert
                size={12}
                uniProps={errorIconColor}
                testID={measuring ? undefined : "sidebar-usage-error"}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {layout === "meters" ? (
        <View style={[styles.meterSlot, leadStyle]}>
          <UsageMeter percent={percent} tone={tone} style={styles.meter} />
        </View>
      ) : null}
      <Text
        style={[styles.percent, layout === "meters" ? null : leadStyle]}
        numberOfLines={1}
        testID={testID}
      >
        {percentText}
        {layout === "percents" || suffix === "" ? null : (
          <Text style={styles.windowLabel}>{` ${suffix}`}</Text>
        )}
      </Text>
    </>
  );
  if (measuring) return <View style={slotStyle}>{body}</View>;
  return (
    <PinnedUsageHover item={item} entry={entry} displayAs={displayAs} slotStyle={slotStyle}>
      {body}
    </PinnedUsageHover>
  );
}

function clusterStyle(
  startsSource: boolean,
  index: number,
  layout: PinnedUsageLayout,
): StyleProp<ViewStyle> {
  return [
    styles.cluster,
    startsSource && index > 0 ? styles.sourceGap : null,
    startsSource ? null : styles.windowGap,
    layout === "meters" ? styles.clusterFlex : null,
  ];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: "100%",
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    // Taller than the icon line so each meter's hover cell is easy to land on.
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface2,
  },
  line: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
  },
  // Wide enough that nothing inside wraps or shrinks; each child reports its natural width.
  measure: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 10_000,
    opacity: 0,
  },
  measured: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
  },
  cluster: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  clusterFlex: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  sourceGap: {
    paddingLeft: theme.spacing[3],
  },
  iconGap: {
    marginLeft: theme.spacing[1.5],
  },
  windowGap: {
    paddingLeft: theme.spacing[2],
  },
  // Every slot takes an equal share of the leftover width, so the line fills the row.
  meterSlot: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: MIN_METER_WIDTH,
    marginRight: METER_GAP,
  },
  meter: {
    flexGrow: 1,
  },
  percent: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  windowLabel: {
    color: theme.colors.foregroundMuted,
  },
}));
