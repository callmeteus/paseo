import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { formatPct } from "./format";
import type { PinnedUsageSource, PinnedUsageWindow } from "./pinned";
import type { UsageWindow } from "./types";
import {
  maxUsedPercent,
  resolveReportUnifiedUsage,
  resolveUnifiedUsage,
  resolveUnifiedUsageBySource,
  unifiedSummarySurface,
} from "./unified";

function window(
  overrides: Partial<PinnedUsageWindow> & { key: string; usedPercent: number },
): PinnedUsageWindow {
  const { key, usedPercent, percent: overridePercent, ...rest } = overrides;
  const percent = overridePercent ?? usedPercent;
  return {
    key,
    label: key,
    shortLabel: "5h",
    percent,
    percentText: `${percent}%`,
    tone: "default",
    sourceId: "claude",
    sourceLabel: "Claude",
    accountLabel: null,
    icon: null,
    windowLabel: "Session",
    usedPercent,
    resetsAt: null,
    runsOutAt: null,
    shortfallPct: null,
    ...rest,
  };
}

function source(windows: PinnedUsageWindow[], key = "source"): PinnedUsageSource {
  return { key, icon: null, windows };
}

describe("resolveUnifiedUsage", () => {
  it("uses the max used share across windows, not the mean", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "session", usedPercent: 20, tone: "ok" }),
        window({ key: "weekly", usedPercent: 95, tone: "danger" }),
        window({ key: "monthly", usedPercent: 28, tone: "default" }),
      ]),
    ]);

    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.percent).toBe(95);
    expect(unified?.usedPercent).toBe(95);
    expect(unified?.tone).toBe("danger");
    expect(unified?.windows.map((entry) => entry.key)).toEqual(["weekly", "monthly", "session"]);
  });

  it("shows remaining from the max used share when the preference is remaining", () => {
    const unified = resolveUnifiedUsage(
      [
        source([
          window({ key: "session", usedPercent: 20, percent: 80 }),
          window({ key: "weekly", usedPercent: 95, percent: 5, tone: "danger" }),
        ]),
      ],
      { displayAs: "remaining" },
    );

    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.percent).toBe(5);
    expect(unified?.usedPercent).toBe(95);
  });

  it("hits 100% when any rolling, weekly, or monthly window is exhausted", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "rolling", usedPercent: 13 }),
        window({ key: "weekly", usedPercent: 99, tone: "danger" }),
        window({ key: "monthly", usedPercent: 100, tone: "danger" }),
      ]),
    ]);

    expect(unified?.percent).toBe(100);
    expect(unified?.usedPercent).toBe(100);
    expect(formatPct(unified?.percent ?? Number.NaN, "en")).toBe("100%");
    expect(formatPct(unified?.percent ?? Number.NaN, "pt-BR")).toBe("100%");
    expect(unified?.driver.key).toBe("monthly");
  });

  it("uses the max when one of the three windows is missing", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "rolling", usedPercent: 24 }),
        window({ key: "monthly", usedPercent: 97 }),
      ]),
    ]);

    expect(unified?.percent).toBe(97);
    expect(unified?.usedPercent).toBe(97);
    expect(unified?.driver.key).toBe("monthly");
  });

  it("breaks ties by the nearest reset", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({
          key: "monthly",
          usedPercent: 100,
          resetsAt: "2026-05-01T00:00:00.000Z",
        }),
        window({ key: "weekly", usedPercent: 100, resetsAt: "2026-04-01T00:00:00.000Z" }),
      ]),
    ]);

    expect(unified?.driver.key).toBe("weekly");
  });

  it("escalates the tone when a window may run out before it resets", () => {
    const unified = resolveUnifiedUsage(
      [
        source([
          window({
            key: "weekly",
            usedPercent: 60,
            tone: "ok",
            runsOutAt: "2026-02-01T00:00:00.000Z",
            shortfallPct: 12,
          }),
        ]),
      ],
      { now: Date.parse("2026-01-01T00:00:00.000Z") },
    );

    expect(unified?.atRiskCount).toBe(1);
    expect(unified?.tone).toBe("danger");
  });

  it("returns nothing when no window has a percentage", () => {
    expect(maxUsedPercent([])).toBeNull();
    expect(maxUsedPercent([])).not.toBe(100);
    expect(resolveUnifiedUsage([])).toBeNull();
    expect(resolveUnifiedUsage([{ key: "source", icon: null, windows: [] }])).toBeNull();
  });
});

describe("unifiedSummarySurface", () => {
  it("uses the light surface only while the block is pinned", () => {
    expect(unifiedSummarySurface(true)).toBe("pinned");
    expect(unifiedSummarySurface(false)).toBe("card");
  });
});

describe("resolveUnifiedUsageBySource", () => {
  it("keeps each provider's worst window separate", () => {
    const items = resolveUnifiedUsageBySource([
      source(
        [window({ key: "session", usedPercent: 20 }), window({ key: "weekly", usedPercent: 69 })],
        "claude",
      ),
      source(
        [
          window({ key: "total", usedPercent: 100, tone: "danger" }),
          window({ key: "third-party", usedPercent: 10 }),
        ],
        "cursor",
      ),
    ]);

    const bySource = items.map((item) => [item.source.key, item.unified.percent] as const);
    expect(bySource[0]?.[0]).toBe("claude");
    expect(bySource[0]?.[1]).toBe(69);
    expect(bySource[1]).toEqual(["cursor", 100]);
    expect(items[0]?.unified.driver.key).toBe("weekly");
    expect(items[1]?.unified.driver.key).toBe("total");
  });
});

describe("resolveReportUnifiedUsage", () => {
  it("summarizes one provider card over all of its percentage windows", () => {
    const windows: UsageWindow[] = [
      { id: "session", label: "Session", usedPct: 0 },
      { id: "weekly", label: "Weekly", usedPct: 69 },
      { id: "unknown", label: "Unknown", usedPct: null, remainingPct: null },
    ];

    const unified = resolveReportUnifiedUsage({
      windows,
      displayAs: "used",
      t: i18n.t,
    });

    expect(unified?.percent).toBe(69);
    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.windows.map((entry) => entry.key)).toEqual(["weekly", "session"]);
  });

  it("shows 100% on the card when any OpenCode Go window is at 100%", () => {
    const windows: UsageWindow[] = [
      { id: "rolling", label: "Rolling", usedPct: 24 },
      { id: "weekly", label: "Weekly", usedPct: 99 },
      { id: "monthly", label: "Monthly", usedPct: 100 },
    ];

    const unified = resolveReportUnifiedUsage({
      windows,
      displayAs: "used",
      t: i18n.t,
    });

    expect(unified?.percent).toBe(100);
    expect(unified?.usedPercent).toBe(100);
    expect(formatPct(unified?.percent ?? Number.NaN, "pt-BR")).toBe("100%");
    expect(unified?.driver.key).toBe("monthly");
    expect(unified?.driver.percent).toBe(100);
    expect(unified?.windows.map((entry) => entry.key)).toEqual(["monthly", "weekly", "rolling"]);
  });

  it("returns nothing without a percentage", () => {
    expect(
      resolveReportUnifiedUsage({
        windows: [{ id: "unknown", label: "Unknown" }],
        displayAs: "used",
        t: i18n.t,
      }),
    ).toBeNull();
  });
});
