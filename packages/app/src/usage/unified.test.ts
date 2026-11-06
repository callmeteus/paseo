import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { formatPct } from "./format";
import type { PinnedUsageSource, PinnedUsageWindow } from "./pinned";
import type { UsageWindow } from "./types";
import {
  meanUsedPercent,
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
  it("averages the windows instead of repeating the largest", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "session", usedPercent: 20, tone: "ok" }),
        window({ key: "weekly", usedPercent: 95, tone: "danger" }),
        window({ key: "monthly", usedPercent: 28, tone: "default" }),
      ]),
    ]);

    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.percent).toBeCloseTo((20 + 95 + 28) / 3, 5);
    expect(unified?.usedPercent).toBeCloseTo((20 + 95 + 28) / 3, 5);
    expect(unified?.percent).not.toBe(95);
    expect(unified?.tone).toBe("danger");
    expect(unified?.windows.map((entry) => entry.key)).toEqual(["weekly", "monthly", "session"]);
  });

  it("shows the mean remaining share when the preference is remaining", () => {
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
    expect(unified?.percent).toBeCloseTo(100 - (20 + 95) / 2, 5);
  });

  it("averages rolling, weekly and monthly instead of lifting them to one limit", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "rolling", usedPercent: 24 }),
        window({ key: "weekly", usedPercent: 93 }),
        window({ key: "monthly", usedPercent: 97 }),
      ]),
    ]);

    const mean = (24 + 93 + 97) / 3;
    expect(unified?.percent).toBeCloseTo(mean, 5);
    expect(unified?.usedPercent).toBeCloseTo(mean, 5);
    expect(unified?.percent).not.toBe(100);
    expect(formatPct(unified?.percent ?? Number.NaN, "en")).toBe("71%");
    expect(formatPct(unified?.percent ?? Number.NaN, "pt-BR")).toBe("71%");
    expect(unified?.driver.key).toBe("monthly");
  });

  it("averages the windows that exist when one of the three is missing", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "rolling", usedPercent: 24 }),
        window({ key: "monthly", usedPercent: 97 }),
      ]),
    ]);

    expect(unified?.percent).toBeCloseTo((24 + 97) / 2, 5);
    expect(unified?.percent).not.toBe(100);
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
    expect(meanUsedPercent([])).toBeNull();
    expect(meanUsedPercent([])).not.toBe(100);
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
    expect(bySource[0]?.[1]).toBeCloseTo((20 + 69) / 2, 5);
    expect(bySource[1]).toEqual(["cursor", 55]);
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

    expect(unified?.percent).toBe(34.5);
    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.windows.map((entry) => entry.key)).toEqual(["weekly", "session"]);
  });

  it("averages an OpenCode Go card instead of showing 100", () => {
    const windows: UsageWindow[] = [
      { id: "rolling", label: "Rolling", usedPct: 24 },
      { id: "weekly", label: "Weekly", usedPct: 93 },
      { id: "monthly", label: "Monthly", usedPct: 97 },
    ];

    const unified = resolveReportUnifiedUsage({
      windows,
      displayAs: "used",
      t: i18n.t,
    });

    expect(unified?.percent).toBeCloseTo((24 + 93 + 97) / 3, 5);
    expect(unified?.percent).not.toBe(100);
    expect(formatPct(unified?.percent ?? Number.NaN, "pt-BR")).toBe("71%");
    expect(unified?.driver.key).toBe("monthly");
    expect(unified?.driver.percent).toBe(97);
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
