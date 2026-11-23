import type { TFunction } from "i18next";
import { i18n } from "@/i18n/i18next";
import {
  formatDisplayPct,
  formatPct,
  formatProviderUsageLabel,
  formatUsageAccountName,
  formatUsageSourceLabel,
} from "./format";
import { displayPercent, resolveUsageSnapshot, usedPercent } from "./model";
import {
  effectiveUsagePins,
  UNIFIED_USAGE_PIN_ID,
  usageReportsOn,
  type UsagePreferences,
} from "./preferences";
import { windowTone } from "./tone";
import type { UsageReportEntry, UsageWindow } from "./types";
import { resolveUnifiedUsage, type UnifiedUsage, type UnifiedWindow } from "./unified";

/** One summary window of one account, as the sidebar Usage item shows it. */
export interface PinnedUsageWindow extends UnifiedWindow {
  sourceId: string;
  sourceLabel: string;
  accountLabel: string | null;
  icon: string | null;
  windowLabel: string;
  /** Bare period token ("5h", "wk", "mo") used when full short labels overflow the sidebar row. */
  compactLabel: string;
}

/** One account's summary windows, under its source's icon. */
export interface PinnedUsageSource {
  key: string;
  icon: string | null;
  /** The displayed values are retained from before a failed refresh. */
  hasError: boolean;
  windows: PinnedUsageWindow[];
}

/** How much of each window the one-line summary has room for. */
export type PinnedUsageLayout = "meters" | "labels" | "compact" | "percents";

// A meter narrower than this is a sliver that reads as noise rather than a share.
export const MIN_METER_WIDTH = 16;
/** The space between a meter and its text. */
export const METER_GAP = 4;

const DURATION_TOKEN_PATTERN = /^\d+[smhd]$/i;

function normalizePeriodToken(token: string): string | null {
  const lower = token.toLowerCase();
  if (lower === "wk" || lower === "weekly") return "wk";
  if (lower === "mo" || lower === "monthly") return "mo";
  if (DURATION_TOKEN_PATTERN.test(token)) return lower;
  return null;
}

/**
 * Extracts a bare period token ("5h", "wk", "mo") from a window's short label so tight sidebar
 * rows can keep shorthands visible instead of dropping every label when one window is scoped.
 */
function compactShortLabel(shortLabel: string): string {
  const trimmed = shortLabel.trim();
  if (trimmed === "") return "";
  const exact = normalizePeriodToken(trimmed);
  if (exact !== null) return exact;
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    const first = normalizePeriodToken(parts[0]!);
    if (first !== null) return first;
    const last = normalizePeriodToken(parts[parts.length - 1]!);
    if (last !== null) return last;
  }
  return "";
}

/**
 * The richest layout that fits on one line: every window's meter, else its short label, else its
 * bare period shorthand, else its percent alone. Meters are all or none; a line never mixes them.
 * Until the widths are known it shows labels, which never flashes meters that turn out not to fit.
 */
export function choosePinnedUsageLayout(input: {
  available: number | null;
  labelsWidth: number | null;
  compactWidth: number | null;
  percentsWidth: number | null;
  windowCount: number;
}): PinnedUsageLayout {
  const { available, labelsWidth, compactWidth, percentsWidth, windowCount } = input;
  if (
    available === null ||
    labelsWidth === null ||
    compactWidth === null ||
    percentsWidth === null
  ) {
    return "labels";
  }
  if (labelsWidth + windowCount * (MIN_METER_WIDTH + METER_GAP) <= available) return "meters";
  if (labelsWidth <= available) return "labels";
  if (compactWidth <= available && compactWidth > percentsWidth) return "compact";
  return percentsWidth < labelsWidth ? "percents" : "labels";
}

/** Reports with every account of a source together, sources in the order they first appear. */
function groupBySource(reports: readonly UsageReportEntry[]): UsageReportEntry[] {
  const sourceIds = [...new Set(reports.map((entry) => entry.sourceId))];
  return sourceIds.flatMap((sourceId) => reports.filter((entry) => entry.sourceId === sourceId));
}

function describe(entry: UsageReportEntry, windowLabel: string): string {
  return `${formatUsageAccountName(entry)} ${windowLabel}`;
}

function pinnedWindow(
  entry: UsageReportEntry,
  window: UsageWindow,
  preferences: UsagePreferences,
  t: TFunction,
): PinnedUsageWindow {
  const percent = displayPercent(window, preferences.displayAs) ?? 0;
  const percentText = formatPct(percent);
  const windowLabel = formatProviderUsageLabel(window.id, window.label, t);
  return {
    key: `${entry.id}/${window.id}`,
    label: `${describe(entry, windowLabel)} ${formatDisplayPct(percent, preferences.displayAs, undefined, t)}`,
    shortLabel: window.shortLabel ?? windowLabel,
    compactLabel: compactShortLabel(window.shortLabel ?? windowLabel),
    percent,
    percentText,
    tone: windowTone(window),
    sourceId: entry.sourceId,
    sourceLabel: formatUsageSourceLabel(entry.sourceId, entry.sourceLabel, t),
    accountLabel: entry.account.label ?? null,
    icon: entry.icon ?? null,
    windowLabel,
    usedPercent: usedPercent(window) ?? 0,
    resetsAt: window.resetsAt ?? null,
    runsOutAt: window.runsOutAt ?? null,
    shortfallPct: window.shortfallPct ?? null,
  };
}

/**
 * The sidebar Usage item's summary: one group per account in card order, each with its windows in
 * its report's order. Accounts turned off or with nothing to show are left out.
 */
export function resolvePinnedUsage(
  reports: readonly UsageReportEntry[],
  preferences: UsagePreferences,
  t: TFunction = i18n.t,
): PinnedUsageSource[] {
  const pins = effectiveUsagePins(preferences, reports);
  return usageReportsOn(reports, preferences).flatMap((entry) => {
    const snapshot = resolveUsageSnapshot(entry);
    if (!snapshot) return [];
    const windows = snapshot.report.windows
      .filter(
        (window) =>
          displayPercent(window, preferences.displayAs) !== null &&
          pins.some((pin) => pin.sourceId === entry.sourceId && pin.windowId === window.id),
      )
      .map((window) => pinnedWindow(entry, window, preferences, t));
    if (windows.length === 0) return [];
    return [
      {
        key: entry.id,
        icon: entry.icon ?? null,
        hasError: entry.report.status === "error",
        windows,
      },
    ];
  });
}

/** One entry in the sidebar Usage line: a pinned window or a provider's unified summary. */
export type PinnedUsageItem =
  | {
      kind: "unified";
      key: string;
      sourceKey: string;
      source: PinnedUsageSource;
      unified: UnifiedUsage<PinnedUsageWindow>;
    }
  | { kind: "window"; key: string; sourceKey: string; window: PinnedUsageWindow };

/**
 * The sidebar Usage line, in source/report order: the unified summary when its pin is on,
 * then each pinned window. A window pin no longer pulls in the provider's other windows.
 */
export function resolvePinnedUsageItems(
  reports: readonly UsageReportEntry[],
  preferences: UsagePreferences,
  t: TFunction = i18n.t,
): PinnedUsageItem[] {
  const pins = effectiveUsagePins(preferences, reports);
  return groupBySource(usageReportsOn(reports, preferences)).flatMap((entry) => {
    // A failed refresh still shows its retained values, the same way the summary does, so the
    // source can carry hasError instead of dropping the windows entirely.
    const snapshot = resolveUsageSnapshot(entry);
    if (!snapshot) return [];
    const sourcePins = pins.filter((pin) => pin.sourceId === entry.sourceId);
    if (sourcePins.length === 0) return [];

    const allWindows = snapshot.report.windows
      .filter((window) => displayPercent(window, preferences.displayAs) !== null)
      .map((window) => pinnedWindow(entry, window, preferences, t));
    const source: PinnedUsageSource = {
      key: entry.id,
      icon: entry.icon ?? null,
      hasError: entry.report.status === "error",
      windows: allWindows,
    };
    const items: PinnedUsageItem[] = [];

    if (allWindows.length > 0 && sourcePins.some((pin) => pin.windowId === UNIFIED_USAGE_PIN_ID)) {
      const unified = resolveUnifiedUsage([source], { displayAs: preferences.displayAs });
      if (unified) {
        items.push({
          kind: "unified",
          key: `${entry.id}/${UNIFIED_USAGE_PIN_ID}`,
          sourceKey: entry.id,
          source,
          unified,
        });
      }
    }

    const pinnedWindowIds = new Set(
      sourcePins.filter((pin) => pin.windowId !== UNIFIED_USAGE_PIN_ID).map((pin) => pin.windowId),
    );
    for (const raw of snapshot.report.windows) {
      if (!pinnedWindowIds.has(raw.id)) continue;
      if (displayPercent(raw, preferences.displayAs) === null) continue;
      items.push({
        kind: "window",
        key: `${entry.id}/${raw.id}`,
        sourceKey: entry.id,
        window: pinnedWindow(entry, raw, preferences, t),
      });
    }

    return items;
  });
}
