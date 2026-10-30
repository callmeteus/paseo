import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { PinnedUsageSource, PinnedUsageWindow } from "./pinned";
import type { UsageWindow } from "./types";
import {
  resolveReportUnifiedUsage,
  resolveUnifiedUsage,
  resolveUnifiedUsageBySource,
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
  it("combines the windows instead of repeating the largest", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "session", usedPercent: 20, tone: "ok" }),
        window({ key: "weekly", usedPercent: 95, tone: "danger" }),
        window({ key: "monthly", usedPercent: 28, tone: "default" }),
      ]),
    ]);

    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.percent).toBeCloseTo(97.12, 2);
    expect(unified?.usedPercent).toBeCloseTo(97.12, 2);
    expect(unified?.tone).toBe("danger");
    expect(unified?.windows.map((entry) => entry.key)).toEqual(["weekly", "monthly", "session"]);
  });

  it("shows the combined remaining share when the preference is remaining", () => {
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
    expect(unified?.percent).toBeCloseTo(4, 2);
  });

  it("combines the rolling, weekly and monthly windows above the largest one", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "rolling", usedPercent: 14 }),
        window({ key: "weekly", usedPercent: 69 }),
        window({ key: "monthly", usedPercent: 37 }),
      ]),
    ]);

    expect(unified?.percent).toBeCloseTo(83.2, 1);
    expect(unified?.driver.key).toBe("weekly");
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
    expect(resolveUnifiedUsage([])).toBeNull();
    expect(resolveUnifiedUsage([{ key: "source", icon: null, windows: [] }])).toBeNull();
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
    expect(bySource[0]?.[1]).toBeCloseTo(75.2, 2);
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
