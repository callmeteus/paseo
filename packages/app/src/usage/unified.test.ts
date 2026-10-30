import { describe, expect, it } from "vitest";
import type { PinnedUsageSource, PinnedUsageWindow } from "./pinned";
import { resolveUnifiedUsage } from "./unified";

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

function source(windows: PinnedUsageWindow[]): PinnedUsageSource {
  return { key: "source", icon: null, windows };
}

describe("resolveUnifiedUsage", () => {
  it("takes the most constrained window instead of averaging", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "session", usedPercent: 20, tone: "ok" }),
        window({ key: "weekly", usedPercent: 95, tone: "danger" }),
        window({ key: "monthly", usedPercent: 28, tone: "default" }),
      ]),
    ]);

    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.percent).toBe(95);
    expect(unified?.tone).toBe("danger");
    expect(unified?.windows.map((entry) => entry.key)).toEqual(["weekly", "monthly", "session"]);
  });

  it("shows the smallest remaining share when the preference is remaining", () => {
    const unified = resolveUnifiedUsage([
      source([
        window({ key: "session", usedPercent: 20, percent: 80 }),
        window({ key: "weekly", usedPercent: 95, percent: 5, tone: "danger" }),
      ]),
    ]);

    expect(unified?.driver.key).toBe("weekly");
    expect(unified?.percent).toBe(5);
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
