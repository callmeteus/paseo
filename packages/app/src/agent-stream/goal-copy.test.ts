import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { localizeGoalNotice } from "./goal-copy";

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}|${JSON.stringify(params)}` : key) as unknown as TFunction;

describe("localizeGoalNotice", () => {
  it("translates every goal command notice", () => {
    expect(localizeGoalNotice("Goal cleared.", t)).toBe("goalNotice.cleared");
    expect(localizeGoalNotice("Goal set: ship it", t)).toBe(
      'goalNotice.set|{"objective":"ship it"}',
    );
    expect(localizeGoalNotice("Goal paused: ship it", t)).toBe(
      'goalNotice.paused|{"objective":"ship it"}',
    );
    expect(localizeGoalNotice("Goal resumed: ship it", t)).toBe(
      'goalNotice.resumed|{"objective":"ship it"}',
    );
    expect(localizeGoalNotice("Goal complete: ship it", t)).toBe(
      'goalNotice.complete|{"objective":"ship it"}',
    );
  });

  it("maps the goal status line with a translated state label", () => {
    expect(localizeGoalNotice("Goal (active): ship it", t)).toBe(
      'goalNotice.status|{"status":"goalNotice.activeLabel","objective":"ship it"}',
    );
    expect(localizeGoalNotice("Goal (paused): ship it", t)).toBe(
      'goalNotice.status|{"status":"goalNotice.pausedLabel","objective":"ship it"}',
    );
  });

  it("translates the continuation limit and the empty-state help", () => {
    expect(
      localizeGoalNotice(
        "Goal did not complete after 50 continuation attempts. The goal watcher stopped; send another message, or /goal resume to restart it.",
        t,
      ),
    ).toBe('goalNotice.continuousLimit|{"max":"50"}');
    expect(
      localizeGoalNotice(
        "No goal set. Usage: /goal <objective> | /goal pause | /goal resume | /goal clear",
        t,
      ),
    ).toBe("goalNotice.noGoal");
  });

  it("leaves ordinary assistant text untouched", () => {
    expect(localizeGoalNotice("Implemented the endpoint.", t)).toBe("Implemented the endpoint.");
  });
});
