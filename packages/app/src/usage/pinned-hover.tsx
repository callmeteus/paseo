import type { TFunction } from "i18next";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { isWeb } from "@/constants/platform";
import { formatUsageDetailLabel, formatUsagePlanLabel } from "./format";
import { resolveUsageReport } from "./model";
import type { PinnedUsageItem } from "./pinned";
import { UsageSourceIcon } from "./source-icon";
import type { UsageDisplayAs } from "./preferences";
import type { UsageReportEntry, UsageWindow } from "./types";
import { resolveReportUnifiedUsage } from "./unified";
import { UnifiedUsageSummary } from "./unified-summary";
import { UsageBalanceBar } from "./balance-bar";
import { UsageWindowBar } from "./window-bar";

const ignorePin = () => {};

/**
 * One pinned sidebar meter. Hovering it, and only it, opens the consumption readout the Usage
 * tab shows for that pin. A press still belongs to the row around these meters.
 */
export function PinnedUsageHover({
  item,
  entry,
  displayAs,
  slotStyle,
  children,
}: {
  item: PinnedUsageItem;
  entry: UsageReportEntry | null;
  displayAs: UsageDisplayAs;
  slotStyle: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const showHover = useCallback(() => setHovered(true), []);
  const hideHover = useCallback(() => setHovered(false), []);
  const label = hoverLabel(item, t);
  if (!isWeb) return <View style={slotStyle}>{children}</View>;
  return (
    <HoverCard>
      <HoverCardTrigger style={slotStyle} accessibilityLabel={label}>
        <View
          style={hovered ? [styles.hit, styles.hitHovered] : styles.hit}
          onPointerEnter={showHover}
          onPointerLeave={hideHover}
          testID="sidebar-usage-item"
        >
          {children}
        </View>
      </HoverCardTrigger>
      <HoverCardContent
        placement="top"
        offset={8}
        accessibilityLabel={label}
        testID="sidebar-usage-popover"
        style={styles.card}
      >
        <PinnedUsagePopoverBody item={item} entry={entry} displayAs={displayAs} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** The Usage tab's consumption for one pin: the whole account for Overall, one window otherwise. */
export function PinnedUsagePopoverBody({
  item,
  entry,
  displayAs,
}: {
  item: PinnedUsageItem;
  entry: UsageReportEntry | null;
  displayAs: UsageDisplayAs;
}) {
  const { t } = useTranslation();
  const resolved = entry ? resolveUsageReport(entry, t) : null;
  const source = sourceIdentity(item);
  const unified =
    item.kind === "unified" && resolved && resolved.windows.length > 1
      ? resolveReportUnifiedUsage({ windows: resolved.windows, displayAs, t })
      : null;
  const windows = windowsForPin(item, entry, resolved?.windows ?? []);
  return (
    <View>
      <View style={styles.header}>
        <UsageSourceIcon svg={source.icon} size={14} />
        <Text style={styles.name} numberOfLines={1}>
          {source.label}
        </Text>
        {resolved?.planLabel ? (
          <StatusBadge
            label={formatUsagePlanLabel(resolved.planLabel, t)}
            variant="muted"
            size="xs"
          />
        ) : null}
      </View>
      {source.account ? (
        <Text style={styles.account} numberOfLines={1}>
          {source.account}
        </Text>
      ) : null}
      {unified ? (
        <UnifiedUsageSummary
          unified={unified}
          displayAs={displayAs}
          retained={resolved?.retained ?? false}
          dense
        />
      ) : null}
      <View style={styles.bars}>
        {windows.map((window) => (
          <UsageWindowBar
            key={window.id}
            window={window}
            retained={resolved?.retained ?? false}
            displayAs={displayAs}
            pinnable={false}
            pinned={false}
            onTogglePin={ignorePin}
            pinLabel=""
            pinTestID=""
          />
        ))}
        {item.kind === "unified"
          ? (resolved?.balances ?? []).map((balance) => (
              <UsageBalanceBar
                key={balance.id}
                balance={balance}
                retained={resolved?.retained ?? false}
              />
            ))
          : null}
      </View>
      {item.kind === "unified" && resolved && resolved.details.length > 0 ? (
        <View style={styles.details}>
          {resolved.details.map((detail) => (
            <View key={detail.id} style={styles.detailRow}>
              <Text style={styles.detailLabel} numberOfLines={1}>
                {formatUsageDetailLabel(detail.id, detail.label, t)}
              </Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {detail.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function hoverLabel(item: PinnedUsageItem, t: TFunction): string {
  if (item.kind === "unified") {
    return `${item.unified.driver.sourceLabel} ${t("providerUsage.unified.title")}`;
  }
  return item.window.label;
}

function sourceIdentity(item: PinnedUsageItem): {
  label: string;
  account: string | null;
  icon: string | null;
} {
  if (item.kind === "unified") {
    return {
      label: item.unified.driver.sourceLabel,
      account: item.unified.driver.accountLabel,
      icon: item.source.icon,
    };
  }
  return {
    label: item.window.sourceLabel,
    account: item.window.accountLabel,
    icon: item.window.icon,
  };
}

function windowsForPin(
  item: PinnedUsageItem,
  entry: UsageReportEntry | null,
  windows: readonly UsageWindow[],
): UsageWindow[] {
  if (item.kind === "unified") return [...windows];
  if (!entry) return [];
  return windows.filter((window) => `${entry.id}/${window.id}` === item.window.key);
}

const styles = StyleSheet.create((theme) => ({
  hit: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    borderRadius: theme.borderRadius.md,
  },
  hitHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  card: {
    width: 300,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  account: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
  },
  bars: {
    gap: theme.spacing[1],
  },
  details: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  detailLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  detailValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
