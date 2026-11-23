import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  formatDisplayPct,
  formatPct,
  formatProviderUsageLabel,
  formatResetLabel,
  formatResetTime,
  formatRunsOutLabel,
} from "./format";
import { UsageMeter } from "./meter";
import { displayPercent, usageWindowRowLabel } from "./model";
import { usagePace } from "./pace";
import { UsagePinGlyph } from "./pin-glyph";
import type { UsageDisplayAs } from "./preferences";
import { UsageResetLine } from "./reset-line";
import { windowTone } from "./tone";
import type { UsageTone, UsageWindow } from "./types";
import { useRelativeTimeTick } from "./use-relative-time-tick";

// Pinned rows carry the pinned surface; hovering an unpinned row previews it at half strength,
// so a hover never reads as the selection. Pinned rows do not react to hover.
function highlightStyle(pinned: boolean, hovered: boolean) {
  if (pinned) return styles.highlightPinned;
  return hovered ? styles.highlightHovered : styles.highlightNone;
}

export function UsageWindowBar({
  window,
  displayAs,
  pinnable,
  pinned,
  onTogglePin,
  pinLabel,
  pinTestID,
  retained = false,
  shortReset = false,
  forecastAt,
}: {
  retained?: boolean;
  /** "in 2h" instead of "resets in 2h". The usage tab keeps the full phrase. */
  shortReset?: boolean;
  /** When the quota reading was observed. Optional for callers that have no observation time. */
  forecastAt?: string | null;
  window: UsageWindow;
  displayAs: UsageDisplayAs;
  /** Whether the row pins the window to the sidebar. When false the row is a plain bar. */
  pinnable: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  /** What the row pins, naming the source and window: "Pin Claude Session". */
  pinLabel: string;
  pinTestID: string;
}) {
  const { t, i18n } = useTranslation();
  const shownPct = displayPercent(window, displayAs);
  const tone = windowTone(window);
  const now = useRelativeTimeTick({ enabled: window.runsOutAt != null || window.resetsAt != null });
  const pace = usagePace(window, forecastAt ?? null, now);
  const forecast = formatPace(pace, now, t);
  const countdown = formatResetLabel(window.resetsAt, retained, now, t, shortReset);
  const exactTime = formatResetTime(window.resetsAt, now, t);

  const value =
    shownPct != null ? formatDisplayPct(shownPct, displayAs, i18n.resolvedLanguage, t) : "—";
  const accessibilityState = useMemo(() => ({ checked: pinned }), [pinned]);
  const content = {
    label: formatProviderUsageLabel(window.id, window.label, t),
    value,
    countdown,
    exactTime,
    forecast,
    percent: shownPct ?? 0,
    tone: forecast?.tone ?? tone,
    pinned,
  };

  if (!pinnable) {
    return (
      <View style={styles.row}>
        <WindowRowContent {...content} highlight={styles.highlightNone} pinnable={false} />
      </View>
    );
  }

  // The whole row pins the window to the sidebar Usage item. Pinned or not, it keeps the same
  // padding so toggling only changes the background.
  return (
    <Pressable
      onPress={onTogglePin}
      accessibilityRole="checkbox"
      accessibilityLabel={usageWindowRowLabel({
        pinLabel,
        value,
        trailing: [countdown, exactTime, forecast?.label].filter(Boolean).join(" · "),
      })}
      accessibilityState={accessibilityState}
      aria-checked={pinned}
      style={styles.row}
      testID={pinTestID}
    >
      {({ hovered }: { hovered?: boolean }) => (
        <WindowRowContent
          {...content}
          highlight={highlightStyle(pinned, Boolean(hovered))}
          pinnable
        />
      )}
    </Pressable>
  );
}

function WindowRowContent({
  highlight,
  label,
  value,
  countdown,
  exactTime,
  forecast,
  percent,
  tone,
  pinnable,
  pinned,
}: {
  highlight: StyleProp<ViewStyle>;
  label: string;
  value: string;
  countdown: string | null;
  exactTime: string | null;
  forecast: PaceLabel | null;
  percent: number;
  tone: UsageTone;
  pinnable: boolean;
  pinned: boolean;
}) {
  return (
    <>
      <View style={highlight} pointerEvents="none" />
      <View style={styles.labelRow}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        {pinnable ? (
          <UsagePinGlyph
            pinned={pinned}
            testID={pinned ? "usage-pin-glyph-pinned" : "usage-pin-glyph-unpinned"}
          />
        ) : null}
      </View>
      <UsageMeter percent={percent} tone={tone} />
      {countdown || forecast ? (
        <View style={styles.timingRow}>
          <View style={styles.resetTiming}>
            <UsageResetLine countdown={countdown} exactTime={exactTime} />
          </View>
          {forecast ? <Text style={styles.forecast(forecast.tone)}>{forecast.label}</Text> : null}
        </View>
      ) : null}
    </>
  );
}

interface PaceLabel {
  label: string;
  tone: UsageTone;
}

function formatPace(
  pace: ReturnType<typeof usagePace>,
  now: number,
  t: TFunction,
): PaceLabel | null {
  switch (pace.kind) {
    case "reached":
      return { label: t("providerUsage.timing.limitReached"), tone: "danger" };
    case "runsOut": {
      const label =
        Date.parse(pace.at) <= now
          ? t("providerUsage.timing.mayHaveRunOut")
          : formatRunsOutLabel(pace.at, now, t);
      return label ? { label, tone: "danger" } : null;
    }
    case "remaining":
      return {
        label: t("providerUsage.timing.projectedLeftAtReset", {
          percentage: formatPct(pace.remainingAtResetPct),
        }),
        tone: pace.remainingAtResetPct <= 10 ? "warning" : "default",
      };
    case "unknown":
      return null;
  }
}

const styles = StyleSheet.create((theme) => ({
  // The pinned surface at half strength: a separate layer, so the text keeps full opacity.
  highlightNone: { display: "none" },
  highlightPinned: {
    ...StyleSheet.absoluteFill,
    zIndex: -1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  highlightHovered: {
    ...StyleSheet.absoluteFill,
    zIndex: -1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    opacity: theme.opacity[50],
  },
  row: {
    gap: 3,
    // The highlight bleeds into the card padding so the label and bar stay on the card's rail.
    marginHorizontal: -theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    // Its own stacking context, so the highlight layer paints above the card and below the text.
    zIndex: 0,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  label: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  value: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  timingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  resetTiming: { flex: 1, minWidth: 0 },
  forecast: (tone: UsageTone) => ({
    color: {
      danger: theme.colors.statusDanger,
      warning: theme.colors.statusWarning,
      default: theme.colors.foregroundMuted,
      ok: theme.colors.statusSuccess,
    }[tone],
    fontSize: theme.fontSize.sm,
    maxWidth: "50%",
    textAlign: "right",
  }),
}));
