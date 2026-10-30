import type { TFunction } from "i18next";
import { formatPct, formatProviderUsageLabel } from "./format";
import { displayPercent, usedPercent } from "./model";
import type { PinnedUsageSource, PinnedUsageWindow } from "./pinned";
import type { UsageDisplayAs } from "./preferences";
import { windowTone } from "./tone";
import type { UsageTone, UsageWindow } from "./types";

/** One window as the unified summary needs it, without its source's identity. */
export interface UnifiedWindow {
  key: string;
  /** Accessible description of the window. */
  label: string;
  /** The window's short name ("5h"), empty for none, or its label when the source sends none. */
  shortLabel: string;
  /** The share shown, under the user's used/remaining preference. */
  percent: number;
  percentText: string;
  tone: UsageTone;
  /** The share used, independent of the display preference. */
  usedPercent: number;
  resetsAt: string | null;
  runsOutAt: string | null;
  shortfallPct: number | null;
}

/** The window that drives the summary: the most constrained one. */
export interface UnifiedUsage<T extends UnifiedWindow = UnifiedWindow> {
  /** The driver's share under the user's used/remaining preference. */
  percent: number;
  percentText: string;
  /** The worst tone among the selected windows, escalated when one may run out. */
  tone: UsageTone;
  driver: T;
  /** Every contributing window, most constrained first. */
  windows: T[];
  /** Windows the source projects to run out before their reset. */
  atRiskCount: number;
}

const TONE_RANK: Record<UsageTone, number> = {
  default: 0,
  ok: 1,
  warning: 2,
  danger: 3,
};

function resetTime(window: UnifiedWindow): number {
  if (!window.resetsAt) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(window.resetsAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function isAtRisk(window: UnifiedWindow, now: number): boolean {
  return (
    window.runsOutAt != null && window.shortfallPct != null && Date.parse(window.runsOutAt) > now
  );
}

/**
 * One number for a set of windows: the most constrained window, never an average, so a
 * weekly or monthly window nearing its end cannot hide behind a fresh one.
 */
export function resolveUnifiedWindows<T extends UnifiedWindow>(
  windows: readonly T[],
  options: { now?: number } = {},
): UnifiedUsage<T> | null {
  if (windows.length === 0) return null;

  const now = options.now ?? Date.now();
  const ordered = windows
    .map((window, index) => ({ window, index }))
    .sort(
      (left, right) =>
        right.window.usedPercent - left.window.usedPercent ||
        resetTime(left.window) - resetTime(right.window) ||
        left.index - right.index,
    )
    .map(({ window }) => window);
  const driver = ordered[0]!;
  let tone = driver.tone;
  let atRiskCount = 0;
  for (const window of ordered) {
    if (TONE_RANK[window.tone] > TONE_RANK[tone]) tone = window.tone;
    if (isAtRisk(window, now)) atRiskCount++;
  }
  if (atRiskCount > 0) tone = "danger";

  return {
    percent: driver.percent,
    percentText: formatPct(driver.percent),
    tone,
    driver,
    windows: ordered,
    atRiskCount,
  };
}

/** The unified summary over the user's pinned windows, across every source. */
export function resolveUnifiedUsage(
  sources: readonly PinnedUsageSource[],
  options: { now?: number } = {},
): UnifiedUsage<PinnedUsageWindow> | null {
  return resolveUnifiedWindows(
    sources.flatMap((source) => source.windows),
    options,
  );
}

export interface SourceUnifiedUsage {
  source: PinnedUsageSource;
  unified: UnifiedUsage<PinnedUsageWindow>;
}

/** One unified summary per provider account, each over its own pinned windows. */
export function resolveUnifiedUsageBySource(
  sources: readonly PinnedUsageSource[],
  options: { now?: number } = {},
): SourceUnifiedUsage[] {
  return sources.flatMap((source) => {
    const unified = resolveUnifiedUsage([source], options);
    return unified ? [{ source, unified }] : [];
  });
}

/** A provider card's own unified summary over every window it reports. */
export function resolveReportUnifiedUsage(input: {
  windows: readonly UsageWindow[];
  displayAs: UsageDisplayAs;
  t: TFunction;
  now?: number;
}): UnifiedUsage | null {
  const windows: UnifiedWindow[] = [];
  for (const window of input.windows) {
    const percent = displayPercent(window, input.displayAs);
    const used = usedPercent(window);
    if (percent == null || used == null) continue;
    const label = formatProviderUsageLabel(window.id, window.label, input.t);
    windows.push({
      key: window.id,
      label,
      shortLabel: window.shortLabel ?? label,
      percent,
      percentText: formatPct(percent),
      tone: windowTone(window),
      usedPercent: used,
      resetsAt: window.resetsAt ?? null,
      runsOutAt: window.runsOutAt ?? null,
      shortfallPct: window.shortfallPct ?? null,
    });
  }
  return resolveUnifiedWindows(windows, { now: input.now });
}
