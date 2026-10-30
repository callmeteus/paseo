import { Activity } from "lucide-react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { PressHighlight } from "@/components/ui/press-highlight";
import { formatDisplayPct, formatResetLabel } from "./format";
import { UsageMeter } from "./meter";
import { UsagePinGlyph } from "./pin-glyph";
import type { UsageDisplayAs } from "./preferences";
import { useRelativeTimeTick } from "./use-relative-time-tick";
import type { UnifiedUsage } from "./unified";

const ThemedActivity = withUnistyles(Activity);

/** One provider's windows as one number: the most constrained one. */
export function UnifiedUsageSummary({
  unified,
  displayAs,
  retained = false,
  pinnable = false,
  pinned = false,
  onTogglePin,
  pinLabel,
  pinTestID,
}: {
  unified: UnifiedUsage;
  displayAs: UsageDisplayAs;
  retained?: boolean;
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  pinLabel?: string;
  pinTestID?: string;
}) {
  const { t, i18n } = useTranslation();
  const now = useRelativeTimeTick({ enabled: unified.driver.resetsAt != null });
  const reset = formatResetLabel(unified.driver.resetsAt, retained, now, t);
  const accessibilityState = useMemo(() => ({ checked: pinned }), [pinned]);
  return (
    <View style={styles.container} testID="usage-unified-summary">
      <View style={styles.header}>
        <ThemedActivity size={14} uniProps={extraMutedIconColorMapping} />
        <Text style={styles.title}>{t("providerUsage.unified.title")}</Text>
        <View style={styles.headerSpacer} />
        <Text style={styles.percent}>
          {formatDisplayPct(unified.percent, displayAs, i18n.resolvedLanguage, t)}
        </Text>
        {pinnable && onTogglePin ? (
          <PressHighlight
            onPress={onTogglePin}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityLabel={pinLabel}
            accessibilityState={accessibilityState}
            aria-checked={pinned}
            testID={pinTestID}
            style={styles.pinButton}
            highlightStyle={styles.pinButtonPressed}
          >
            <UsagePinGlyph pinned={pinned} testID={`${pinTestID ?? "usage-unified-pin"}-glyph`} />
          </PressHighlight>
        ) : null}
      </View>
      <UsageMeter percent={unified.percent} tone={unified.tone} style={styles.meter} />
      <View style={styles.driverRow}>
        <Text style={styles.driver} numberOfLines={1}>
          {t("providerUsage.unified.highest", { window: unified.driver.label })}
        </Text>
        {reset ? (
          <Text style={styles.reset} numberOfLines={1}>
            {reset}
          </Text>
        ) : null}
      </View>
      {unified.atRiskCount > 0 ? (
        <Text style={styles.atRisk}>{t("providerUsage.unified.atRisk")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  headerSpacer: {
    flex: 1,
  },
  percent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  pinButton: {
    padding: 2,
    borderRadius: theme.borderRadius.sm,
  },
  pinButtonPressed: {
    backgroundColor: theme.colors.surface3,
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
  atRisk: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
