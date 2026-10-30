import { Activity } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { settingsStyles } from "@/styles/settings";
import type { UsageDisplayAs } from "./preferences";
import { formatDisplayPct, formatResetLabel } from "./format";
import { UsageMeter } from "./meter";
import { UsageSourceIcon } from "./source-icon";
import type { PinnedUsageWindow } from "./pinned";
import { useRelativeTimeTick } from "./use-relative-time-tick";
import type { UnifiedUsage } from "./unified";

const ThemedActivity = withUnistyles(Activity);

function driverLabel(window: PinnedUsageWindow): string {
  const account = window.accountLabel ? ` (${window.accountLabel})` : "";
  return `${window.sourceLabel}${account} · ${window.windowLabel}`;
}

/** The host's selected windows as one number: the most constrained one. */
export function UnifiedUsageSummary({
  unified,
  displayAs,
}: {
  unified: UnifiedUsage;
  displayAs: UsageDisplayAs;
}) {
  const { t, i18n } = useTranslation();
  const now = useRelativeTimeTick({ enabled: unified.driver.resetsAt != null });
  const reset = formatResetLabel(unified.driver.resetsAt, false, now, t);
  return (
    <View style={[settingsStyles.card, styles.container]} testID="usage-unified-summary">
      <View style={styles.header}>
        <ThemedActivity size={14} uniProps={extraMutedIconColorMapping} />
        <Text style={styles.title}>{t("providerUsage.unified.title")}</Text>
        <View style={styles.headerSpacer} />
        <Text style={styles.percent}>
          {formatDisplayPct(unified.percent, displayAs, i18n.resolvedLanguage, t)}
        </Text>
      </View>
      <UsageMeter percent={unified.percent} tone={unified.tone} style={styles.meter} />
      <View style={styles.driverRow}>
        <Text style={styles.driver} numberOfLines={1}>
          {t("providerUsage.unified.highest", { window: driverLabel(unified.driver) })}
        </Text>
        {reset ? (
          <Text style={styles.reset} numberOfLines={1}>
            {reset}
          </Text>
        ) : null}
      </View>
      <View style={styles.chips}>
        {unified.windows.map((window) => (
          <View
            key={window.key}
            style={[styles.chip, window.key === unified.driver.key ? styles.chipDriver : null]}
          >
            <UsageSourceIcon svg={window.icon} size={12} />
            <Text style={styles.chipValue} numberOfLines={1}>
              {window.percentText}
            </Text>
            {window.shortLabel ? (
              <Text style={styles.chipLabel} numberOfLines={1}>
                {window.shortLabel}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {unified.atRiskCount > 0 ? (
        <Text style={styles.atRisk}>{t("providerUsage.unified.atRisk")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  headerSpacer: {
    flex: 1,
  },
  percent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  meter: {
    height: 6,
    borderRadius: 3,
  },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  driver: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  reset: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  chipDriver: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  chipLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  atRisk: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
