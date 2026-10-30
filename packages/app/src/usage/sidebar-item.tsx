import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import { useUsagePreferences } from "./display";
import { useUsageHostId } from "./hosts";
import { useUsageHostReports } from "./queries";
import { UsageSourceIcon } from "./source-icon";
import { UsageMeter } from "./meter";
import {
  choosePinnedUsageLayout,
  METER_GAP,
  MIN_METER_WIDTH,
  resolvePinnedUsageItems,
  type PinnedUsageItem,
  type PinnedUsageLayout,
} from "./pinned";
import { UsageModal } from "./usage-modal";

/** Each pinned sidebar item: a provider's unified summary or one of its windows. */
function useUsageSummary(): {
  items: readonly PinnedUsageItem[];
} {
  const { t } = useTranslation();
  const { preferences } = useUsagePreferences();
  const reports = useUsageHostReports(useUsageHostId());
  return useMemo(
    () => ({ items: resolvePinnedUsageItems(reports, preferences, t) }),
    [preferences, reports, t],
  );
}

/** Whether the sidebar Usage item has anything to show. */
export function useHasUsageSummary(): boolean {
  return useUsageSummary().items.length > 0;
}

/**
 * The sidebar footer's usage entry: the pinned unified summaries and windows, and nothing
 * while no item is pinned. Pressing it opens the Usage modal.
 */
export function UsageSidebarItem() {
  const { t } = useTranslation();
  const label = t(builtinSidebarNavLabelKey("usage"));
  const openUsage = useOpenSidebarUsage();
  const { items } = useUsageSummary();
  if (items.length === 0) return null;
  return <PinnedUsageTrigger label={label} items={items} onPress={openUsage} />;
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
): string {
  const parts = items.map((item) =>
    item.kind === "unified" ? `${item.unified.driver.label} (${unifiedLabel})` : item.window.label,
  );
  return `${label}: ${parts.join(", ")}`;
}

function triggerStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return hovered ? [styles.trigger, styles.triggerHovered] : styles.trigger;
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
  onPress,
}: {
  label: string;
  items: readonly PinnedUsageItem[];
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<number | null>(null);
  const [labelsWidth, setLabelsWidth] = useState<number | null>(null);
  const [percentsWidth, setPercentsWidth] = useState<number | null>(null);
  const handleAvailableLayout = useCallback((event: LayoutChangeEvent) => {
    setAvailable(layoutWidth(event));
  }, []);
  const handleLabelsLayout = useCallback((event: LayoutChangeEvent) => {
    setLabelsWidth(layoutWidth(event));
  }, []);
  const handlePercentsLayout = useCallback((event: LayoutChangeEvent) => {
    setPercentsWidth(layoutWidth(event));
  }, []);
  const layout = choosePinnedUsageLayout({
    available,
    labelsWidth,
    percentsWidth,
    windowCount: items.length,
  });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={pinnedUsageLabel(label, items, t("providerUsage.unified.short"))}
      style={triggerStyle}
      testID="sidebar-usage"
    >
      <View style={styles.line} onLayout={handleAvailableLayout}>
        <PinnedUsageLine items={items} layout={layout} />
      </View>
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View style={styles.measured} onLayout={handleLabelsLayout}>
          <PinnedUsageLine items={items} layout="labels" measuring />
        </View>
        <View style={styles.measured} onLayout={handlePercentsLayout}>
          <PinnedUsageLine items={items} layout="percents" measuring />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The line's items as direct children of one row, so every meter shares the leftover width
 * equally. The source icon appears once per provider group.
 */
function PinnedUsageLine({
  items,
  layout,
  measuring = false,
}: {
  items: readonly PinnedUsageItem[];
  layout: PinnedUsageLayout;
  measuring?: boolean;
}) {
  const { t } = useTranslation();
  return items.map((item, index) => {
    const previousSourceKey = index === 0 ? null : items[index - 1]!.sourceKey;
    const startsSource = previousSourceKey !== item.sourceKey;
    const iconStyle = startsSource && index > 0 ? styles.sourceGap : null;
    const leadStyle = startsSource ? styles.iconGap : styles.windowGap;
    const icon = item.kind === "unified" ? item.source.icon : item.window.icon;
    const percent = item.kind === "unified" ? item.unified.percent : item.window.percent;
    const percentText =
      item.kind === "unified" ? item.unified.percentText : item.window.percentText;
    const tone = item.kind === "unified" ? item.unified.tone : item.window.tone;
    const shortLabel =
      item.kind === "unified" ? t("providerUsage.unified.short") : item.window.shortLabel;
    let testID: string | undefined;
    if (!measuring) {
      testID = item.kind === "unified" ? "sidebar-usage-unified" : "sidebar-usage-pinned-window";
    }

    return (
      <Fragment key={item.key}>
        {startsSource ? (
          <View style={iconStyle} testID={measuring ? undefined : "sidebar-usage-source"}>
            <UsageSourceIcon svg={icon} size={14} />
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
          {layout === "percents" || shortLabel === "" ? null : (
            <Text style={styles.windowLabel}>{` ${shortLabel}`}</Text>
          )}
        </Text>
      </Fragment>
    );
  });
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    // Same row geometry and leading rail as Add project and the footer icons.
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  line: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
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
  sourceGap: {
    marginLeft: theme.spacing[3],
  },
  iconGap: {
    marginLeft: theme.spacing[1.5],
  },
  windowGap: {
    marginLeft: theme.spacing[2],
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
    height: 6,
    borderRadius: 3,
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
