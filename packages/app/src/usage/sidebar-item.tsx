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
import { Activity } from "lucide-react-native";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
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
  resolvePinnedUsage,
  type PinnedUsageLayout,
  type PinnedUsageSource,
} from "./pinned";
import { resolveUnifiedUsage, type UnifiedUsage } from "./unified";
import { UsageModal } from "./usage-modal";

const ThemedActivity = withUnistyles(Activity);

/** Each summary window with data on the usage host, plus the unified summary over them. */
function useUsageSummary(): {
  sources: readonly PinnedUsageSource[];
  unified: UnifiedUsage | null;
} {
  const { t } = useTranslation();
  const { preferences } = useUsagePreferences();
  const reports = useUsageHostReports(useUsageHostId());
  return useMemo(() => {
    const sources = resolvePinnedUsage(reports, preferences, t);
    return { sources, unified: resolveUnifiedUsage(sources) };
  }, [preferences, reports, t]);
}

/** Whether the sidebar Usage item has anything to show. */
export function useHasUsageSummary(): boolean {
  return useUsageSummary().sources.length > 0;
}

/**
 * The sidebar footer's usage entry: the unified meter over the pinned windows plus each window's
 * source icon and percent, and nothing while no summary window has data, since the footer's Usage
 * icon already opens Usage. Pressing it opens the Usage modal.
 */
export function UsageSidebarItem() {
  const { t } = useTranslation();
  const label = t(builtinSidebarNavLabelKey("usage"));
  const openUsage = useOpenSidebarUsage();
  const { sources, unified } = useUsageSummary();
  if (sources.length === 0) return null;
  return (
    <PinnedUsageTrigger label={label} sources={sources} unified={unified} onPress={openUsage} />
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
  sources: readonly PinnedUsageSource[],
  unified: UnifiedUsage | null,
  unifiedLabel: string,
): string {
  const windows = sources.flatMap((source) => source.windows);
  const parts = windows.map((window) => window.label);
  if (unified && unified.windows.length > 1) {
    const driver = unified.driver;
    const account = driver.accountLabel ? ` (${driver.accountLabel})` : "";
    parts.unshift(
      `${unified.percentText} ${unifiedLabel} (${driver.sourceLabel}${account} · ${driver.windowLabel})`,
    );
  }
  return `${label}: ${parts.join(", ")}`;
}

function triggerStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return hovered ? [styles.trigger, styles.triggerHovered] : styles.trigger;
}

function layoutWidth(event: LayoutChangeEvent): number {
  return event.nativeEvent.layout.width;
}

/**
 * One line: each account's icon, then per window a meter and "31% 5h". Off-screen copies measure
 * the line with labels and with percents alone; the richest layout that fits is shown, and what
 * it leaves out takes no space at all.
 */
function PinnedUsageTrigger({
  label,
  sources,
  unified,
  onPress,
}: {
  label: string;
  sources: readonly PinnedUsageSource[];
  unified: UnifiedUsage | null;
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
  const showUnified = unified !== null && unified.windows.length > 1;
  const layout = choosePinnedUsageLayout({
    available,
    labelsWidth,
    percentsWidth,
    windowCount:
      sources.reduce((count, source) => count + source.windows.length, 0) + (showUnified ? 1 : 0),
  });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={pinnedUsageLabel(
        label,
        sources,
        unified,
        t("providerUsage.unified.short"),
      )}
      style={triggerStyle}
      testID="sidebar-usage"
    >
      <View style={styles.line} onLayout={handleAvailableLayout}>
        <PinnedUsageLine sources={sources} unified={unified} layout={layout} />
      </View>
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View style={styles.measured} onLayout={handleLabelsLayout}>
          <PinnedUsageLine sources={sources} unified={unified} layout="labels" measuring />
        </View>
        <View style={styles.measured} onLayout={handlePercentsLayout}>
          <PinnedUsageLine sources={sources} unified={unified} layout="percents" measuring />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The line's items as direct children of one row, so every meter shares the leftover width
 * equally.
 */
function PinnedUsageLine({
  sources,
  unified,
  layout,
  measuring = false,
}: {
  sources: readonly PinnedUsageSource[];
  unified: UnifiedUsage | null;
  layout: PinnedUsageLayout;
  measuring?: boolean;
}) {
  const { t } = useTranslation();
  const showUnified = unified !== null && unified.windows.length > 1;
  return (
    <>
      {showUnified ? (
        <Fragment>
          <View style={styles.unifiedIcon} testID={measuring ? undefined : "sidebar-usage-unified"}>
            <ThemedActivity size={14} uniProps={extraMutedIconColorMapping} />
          </View>
          {layout === "meters" ? (
            <View style={[styles.meterSlot, styles.iconGap]}>
              <UsageMeter percent={unified.percent} tone={unified.tone} style={styles.meter} />
            </View>
          ) : null}
          <Text
            style={[styles.percent, layout === "meters" ? null : styles.iconGap]}
            numberOfLines={1}
            testID={measuring ? undefined : "sidebar-usage-unified-percent"}
          >
            {unified.percentText}
            {layout === "percents" ? null : (
              <Text style={styles.windowLabel}>{` ${t("providerUsage.unified.short")}`}</Text>
            )}
          </Text>
        </Fragment>
      ) : null}
      {sources.map((source, sourceIndex) => (
        <Fragment key={source.key}>
          <View
            style={showUnified || sourceIndex > 0 ? styles.sourceGap : null}
            testID={measuring ? undefined : "sidebar-usage-source"}
          >
            <UsageSourceIcon svg={source.icon} size={14} />
          </View>
          {source.windows.map((window, windowIndex) => {
            const leadStyle = windowIndex === 0 ? styles.iconGap : styles.windowGap;
            return (
              <Fragment key={window.key}>
                {layout === "meters" ? (
                  <View style={[styles.meterSlot, leadStyle]}>
                    <UsageMeter
                      percent={window.percent}
                      tone={window.tone}
                      quiet
                      style={styles.meter}
                    />
                  </View>
                ) : null}
                <Text
                  style={[styles.percent, layout === "meters" ? null : leadStyle]}
                  numberOfLines={1}
                  testID={measuring ? undefined : "sidebar-usage-pinned-window"}
                >
                  {window.percentText}
                  {layout === "percents" || window.shortLabel === "" ? null : (
                    <Text style={styles.windowLabel}>{` ${window.shortLabel}`}</Text>
                  )}
                </Text>
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </>
  );
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
  unifiedIcon: {
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
