import { describe, expect, it } from "vitest";
import {
  latestLimitResumeItemId,
  limitResumeAction,
  limitResumeIsOffered,
  resolveLimitResumeAt,
  soonestUsageReset,
  usageResetWindows,
} from "./limit-resume";

const PHRASE = "You've hit your session limit \u00b7 resets 5:40am (America/Sao_Paulo)";
const NOW = Date.parse("2026-11-06T06:13:00.000Z");

describe("resolveLimitResumeAt", () => {
  it("uses the clock in the session-limit sentence, in that zone", () => {
    expect(resolveLimitResumeAt({ text: PHRASE, windows: [], now: NOW })).toBe(
      Date.parse("2026-11-06T08:40:00.000Z"),
    );
  });

  it("moves the clock to the next day once that minute has passed", () => {
    expect(
      resolveLimitResumeAt({
        text: PHRASE,
        windows: [],
        now: Date.parse("2026-11-06T09:00:00.000Z"),
      }),
    ).toBe(Date.parse("2026-11-07T08:40:00.000Z"));
  });

  it("keeps the sentence clock when a usage window resets sooner", () => {
    expect(
      resolveLimitResumeAt({
        text: PHRASE,
        windows: [{ usedPct: 100, resetsAt: "2026-11-06T07:00:00.000Z" }],
        now: NOW,
      }),
    ).toBe(Date.parse("2026-11-06T08:40:00.000Z"));
  });

  it("uses the soonest full usage window when the text is another CLI's limit", () => {
    const text =
      "[System Error] Free usage limit reached. Connect a provider or subscribe to OpenCode Go.";
    expect(
      resolveLimitResumeAt({
        text,
        windows: [
          { usedPct: 40, resetsAt: "2026-11-06T07:00:00.000Z" },
          { usedPct: 100, resetsAt: "2026-11-06T12:00:00.000Z" },
          { usedPct: 100, resetsAt: "2026-11-07T00:00:00.000Z" },
        ],
        now: NOW,
      }),
    ).toBe(Date.parse("2026-11-06T12:00:00.000Z"));
  });

  it("ignores a reply that only mentions a limit", () => {
    expect(
      resolveLimitResumeAt({
        text: "Implemented the endpoint.",
        windows: [{ usedPct: 100, resetsAt: "2026-11-06T12:00:00.000Z" }],
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("soonestUsageReset", () => {
  it("falls back to any future window when none is full yet", () => {
    expect(
      soonestUsageReset(
        [
          { usedPct: 90, resetsAt: "2026-11-08T00:00:00.000Z" },
          { usedPct: 10, resetsAt: "2026-11-06T10:00:00.000Z" },
        ],
        NOW,
      ),
    ).toBe(Date.parse("2026-11-06T10:00:00.000Z"));
  });
});

describe("usageResetWindows", () => {
  it("keeps the windows of this chat's provider", () => {
    expect(
      usageResetWindows(
        [
          {
            sourceId: "opencode",
            report: {
              status: "available",
              windows: [{ usedPct: 100, resetsAt: "2026-11-06T12:00:00.000Z" }],
            },
          },
          {
            sourceId: "cursor",
            report: {
              status: "available",
              windows: [{ usedPct: 100, resetsAt: "2026-11-06T18:00:00.000Z" }],
            },
          },
        ],
        "opencode",
      ),
    ).toEqual([{ usedPct: 100, resetsAt: "2026-11-06T12:00:00.000Z" }]);
  });
});

describe("limitResumeIsOffered", () => {
  it("hides the checkbox when a router is selected or the reset has passed", () => {
    expect(limitResumeIsOffered({ routerId: null, resetAt: NOW + 1000, now: NOW })).toBe(true);
    expect(limitResumeIsOffered({ routerId: "router-1", resetAt: NOW + 1000, now: NOW })).toBe(
      false,
    );
    expect(limitResumeIsOffered({ routerId: null, resetAt: NOW - 1, now: NOW })).toBe(false);
    expect(limitResumeIsOffered({ routerId: null, resetAt: null, now: NOW })).toBe(false);
  });
});

describe("limitResumeAction", () => {
  it("sends once the reset is due, and drops a router or a long-missed reset", () => {
    expect(limitResumeAction({ routerId: null, resetAt: NOW, now: NOW })).toBe("send");
    expect(limitResumeAction({ routerId: null, resetAt: NOW + 60_000, now: NOW })).toBe("wait");
    expect(limitResumeAction({ routerId: "router-1", resetAt: NOW, now: NOW })).toBe("drop");
    expect(
      limitResumeAction({
        routerId: null,
        resetAt: NOW - 7 * 60 * 60 * 1000,
        now: NOW,
      }),
    ).toBe("drop");
  });
});

describe("latestLimitResumeItemId", () => {
  it("picks the newest notice", () => {
    expect(
      latestLimitResumeItemId([
        { id: "old", text: PHRASE },
        { id: "reply", text: "Done." },
        { id: "new", text: "You've hit your session limit" },
      ]),
    ).toBe("new");
  });
});
