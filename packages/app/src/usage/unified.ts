import type { TFunction } from "i18next";
import { clampPct, formatPct, formatProviderUsageLabel } from "./format";
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

/** The tightest limit among the windows, and the window that drives the subtitle line. */
export interface UnifiedUsage<T extends UnifiedWindow = UnifiedWindow> {
  /** The max used share, under the user's used/remaining preference. */
  percent: number;
  percentText: string;
  /** The max used share among windows, independent of the display preference. */
  usedPercent: number;
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

function toneForPercent(percent: number): UsageTone {
  if (percent > 90) return "danger";
  if (percent >= 70) return "warning";
  return "default";
}

/**
 * Maximum used share across windows: if any limit is exhausted (100%), the unified
 * row shows 100%. A window not in the list is left out. An empty list is not 100.
 */
export function maxUsedPercent(windows: readonly { usedPercent: number }[]): number | null {
  if (windows.length === 0) return null;
  let max = 0;
  for (const window of windows) max = Math.max(max, clampPct(window.usedPercent));
  return max;
}

/** The unified block's fill: the pinned highlight, or the card surface under it. */
export type UnifiedSummarySurface = "pinned" | "card";

/**
 * The light surface on the unified block is the same highlight a pinned window row uses.
 * It shows only while this block is pinned. Unpinned, the block keeps the card surface.
 */
export function unifiedSummarySurface(pinned: boolean): UnifiedSummarySurface {
  return pinned ? "pinned" : "card";
}

/**
 * One number for a set of windows: the maximum of their used shares (the binding limit).
 * The driver stays the single most-used window (ties break by nearest reset).
 */
export function resolveUnifiedWindows<T extends UnifiedWindow>(
  windows: readonly T[],
  options: { now?: number; displayAs?: UsageDisplayAs } = {},
): UnifiedUsage<T> | null {
  const used = maxUsedPercent(windows);
  if (used == null) return null;

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
  const percent = options.displayAs === "remaining" ? 100 - used : used;
  const driver = ordered[0]!;
  let tone = toneForPercent(used);
  let atRiskCount = 0;
  for (const window of ordered) {
    if (TONE_RANK[window.tone] > TONE_RANK[tone]) tone = window.tone;
    if (isAtRisk(window, now)) atRiskCount++;
  }
  if (atRiskCount > 0) tone = "danger";

  return {
    percent,
    percentText: formatPct(percent),
    usedPercent: used,
    tone,
    driver,
    windows: ordered,
    atRiskCount,
  };
}

/** The unified summary over the user's pinned windows, across every source. */
export function resolveUnifiedUsage(
  sources: readonly PinnedUsageSource[],
  options: { now?: number; displayAs?: UsageDisplayAs } = {},
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
  options: { now?: number; displayAs?: UsageDisplayAs } = {},
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
  return resolveUnifiedWindows(windows, { now: input.now, displayAs: input.displayAs });
}
