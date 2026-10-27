import { describe, expect, test } from "vitest";

import {
  GOAL_COMPLETE_MARKER,
  GOAL_SLASH_COMMAND,
  buildGoalAutoContinuationPrompt,
  buildGoalStartPrompt,
  formatGoalStatus,
  isGoalCompleteText,
  parseGoalCommand,
  planGoalPrompt,
  withDaemonSlashCommands,
  type AgentGoal,
} from "./agent-goal.js";
import type { AgentSlashCommand } from "./agent-sdk-types.js";

const ACTIVE_GOAL: AgentGoal = {
  objective: "make the test suite pass",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("parseGoalCommand", () => {
  test("returns null for text that is not a goal command", () => {
    expect(parseGoalCommand("fix the bug")).toBeNull();
    expect(parseGoalCommand("/goalkeeper fix the bug")).toBeNull();
    expect(parseGoalCommand("please run /goal")).toBeNull();
  });

  test("parses the objective in any casing", () => {
    expect(parseGoalCommand("/goal make the test suite pass")).toEqual({
      kind: "set",
      objective: "make the test suite pass",
    });
    expect(parseGoalCommand("  /GOAL   ship the release  ")).toEqual({
      kind: "set",
      objective: "ship the release",
    });
  });

  test("parses the control subcommands", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "status" });
    expect(parseGoalCommand("/goal pause")).toEqual({ kind: "pause" });
    expect(parseGoalCommand("/goal RESUME")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("/goal clear")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("/goal stop")).toEqual({ kind: "clear" });
  });
});

describe("planGoalPrompt", () => {
  test("starts the turn with the goal instruction", () => {
    const plan = planGoalPrompt({
      prompt: "/goal make the test suite pass",
      goal: ACTIVE_GOAL,
      startedGoal: ACTIVE_GOAL,
    });
    expect(plan?.submittedPromptText).toBe("/goal make the test suite pass");
    expect(plan?.prompt).toContain("<paseo-goal>");
    expect(plan?.prompt).toContain("make the test suite pass");
    expect(plan?.prompt).toContain("Start working toward this goal now.");
  });

  test("carries the goal into later turns", () => {
    const plan = planGoalPrompt({ prompt: "next step", goal: ACTIVE_GOAL, startedGoal: null });
    expect(plan?.submittedPromptText).toBe("next step");
    expect(plan?.prompt).toContain("make the test suite pass");
    expect(String(plan?.prompt).endsWith("next step")).toBe(true);
  });

  test("leaves paused goals and slash commands alone", () => {
    expect(
      planGoalPrompt({
        prompt: "next step",
        goal: { ...ACTIVE_GOAL, status: "paused" },
        startedGoal: null,
      }),
    ).toBeNull();
    expect(planGoalPrompt({ prompt: "/compact", goal: ACTIVE_GOAL, startedGoal: null })).toBeNull();
    expect(planGoalPrompt({ prompt: "", goal: undefined, startedGoal: null })).toBeNull();
  });

  test("does not rewrite structured prompts", () => {
    expect(
      planGoalPrompt({
        prompt: [{ type: "text", text: "see attached" }],
        goal: ACTIVE_GOAL,
        startedGoal: null,
      }),
    ).toBeNull();
  });
});

describe("formatGoalStatus", () => {
  test("explains usage when there is no goal", () => {
    expect(formatGoalStatus(undefined)).toContain("/goal <objective>");
  });

  test("shows the objective and status", () => {
    expect(formatGoalStatus(ACTIVE_GOAL)).toBe("Goal (active): make the test suite pass");
  });
});

describe("buildGoalStartPrompt", () => {
  test("names the goal in the preamble", () => {
    expect(buildGoalStartPrompt(ACTIVE_GOAL)).toContain("Goal: make the test suite pass");
  });
});

describe("buildGoalAutoContinuationPrompt", () => {
  test("continues the goal without a user message and declares the marker", () => {
    const prompt = buildGoalAutoContinuationPrompt(ACTIVE_GOAL);
    expect(prompt).toContain("Goal: make the test suite pass");
    expect(prompt).toContain("No new user message is pending");
    expect(prompt).toContain(GOAL_COMPLETE_MARKER);
  });

  test("is recognized as its own preamble so planGoalPrompt forwards it untouched", () => {
    expect(
      planGoalPrompt({
        prompt: buildGoalAutoContinuationPrompt(ACTIVE_GOAL),
        goal: ACTIVE_GOAL,
        startedGoal: null,
      }),
    ).toBeNull();
  });
});

describe("isGoalCompleteText", () => {
  test("matches the marker in any casing", () => {
    expect(isGoalCompleteText("done. <PASEO-GOAL-COMPLETE>")).toBe(true);
    expect(isGoalCompleteText("still working")).toBe(false);
  });
});

describe("withDaemonSlashCommands", () => {
  test("adds /goal for providers that do not publish it", () => {
    const commands: AgentSlashCommand[] = [{ name: "compact", description: "", argumentHint: "" }];
    expect(withDaemonSlashCommands(commands).map((command) => command.name)).toEqual([
      "compact",
      "goal",
    ]);
  });

  test("keeps a provider-native entry with the same name", () => {
    const native: AgentSlashCommand = {
      name: "goal",
      description: "Native goal",
      argumentHint: "",
    };
    const merged = withDaemonSlashCommands([native]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(native);
    expect(GOAL_SLASH_COMMAND.name).toBe("goal");
  });

  test("does not mutate the provider list", () => {
    const commands: AgentSlashCommand[] = [];
    withDaemonSlashCommands(commands);
    expect(commands).toEqual([]);
  });
});
