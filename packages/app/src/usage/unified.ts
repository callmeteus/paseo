import { formatPct } from "./format";
import type { PinnedUsageSource, PinnedUsageWindow } from "./pinned";
import type { UsageTone } from "./types";

/** The pinned window that drives the unified summary: the most constrained one. */
export interface UnifiedUsage {
  /** The driver's share under the user's used/remaining preference. */
  percent: number;
  percentText: string;
  /** The worst tone among the selected windows, escalated when one may run out. */
  tone: UsageTone;
  driver: PinnedUsageWindow;
  /** Every contributing window, most constrained first. */
  windows: PinnedUsageWindow[];
  /** Windows the source projects to run out before their reset. */
  atRiskCount: number;
}

const TONE_RANK: Record<UsageTone, number> = {
  default: 0,
  ok: 1,
  warning: 2,
  danger: 3,
};

function resetTime(window: PinnedUsageWindow): number {
  if (!window.resetsAt) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(window.resetsAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function isAtRisk(window: PinnedUsageWindow, now: number): boolean {
  return (
    window.runsOutAt != null && window.shortfallPct != null && Date.parse(window.runsOutAt) > now
  );
}

/**
 * One number for every pinned window: the most constrained window, never an average,
 * so a weekly or monthly window nearing its end cannot hide behind a fresh one.
 */
export function resolveUnifiedUsage(
  sources: readonly PinnedUsageSource[],
  options: { now?: number } = {},
): UnifiedUsage | null {
  const indexed = sources.flatMap((source) =>
    source.windows.map((window, index) => ({ window, index })),
  );
  if (indexed.length === 0) return null;

  const now = options.now ?? Date.now();
  indexed.sort(
    (left, right) =>
      right.window.usedPercent - left.window.usedPercent ||
      resetTime(left.window) - resetTime(right.window) ||
      left.index - right.index,
  );
  const windows = indexed.map(({ window }) => window);
  const driver = windows[0]!;
  let tone = driver.tone;
  let atRiskCount = 0;
  for (const window of windows) {
    if (TONE_RANK[window.tone] > TONE_RANK[tone]) tone = window.tone;
    if (isAtRisk(window, now)) atRiskCount++;
  }
  if (atRiskCount > 0) tone = "danger";

  return {
    percent: driver.percent,
    percentText: formatPct(driver.percent),
    tone,
    driver,
    windows,
    atRiskCount,
  };
}
