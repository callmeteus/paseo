import { describe, expect, test, vi } from "vitest";
import { createPlanBuildTracker, type PlanBuildUpdate } from "./plan-builds.js";
import type { AgentManagerEvent } from "./agent/agent-manager.js";

function createHarness() {
  const updates: PlanBuildUpdate[] = [];
  const dispatchBuild = vi.fn(async () => undefined);
  const onDispatchError = vi.fn();
  let listener: ((event: AgentManagerEvent) => void) | null = null;
  const tracker = createPlanBuildTracker({
    emit: (update) => updates.push(update),
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    dispatchBuild,
    onDispatchError,
  });
  const emitEvent = (event: AgentManagerEvent) => {
    if (!listener) throw new Error("tracker is not subscribed");
    listener(event);
  };
  const turnEnded = (agentId: string) =>
    emitEvent({
      type: "agent_stream",
      agentId,
      event: { type: "turn_completed", provider: "claude" },
    });
  return { tracker, updates, dispatchBuild, onDispatchError, turnEnded };
}

const plan = {
  workspaceId: "ws-1",
  path: "plans/feature.md",
  title: "Feature",
  agentId: "agent-1",
};

describe("plan build tracker", () => {
  test("marks the plan as building when a build starts", () => {
    const harness = createHarness();

    harness.tracker.start(plan);

    expect(harness.updates).toEqual([{ ...plan, building: true }]);
    expect(harness.dispatchBuild).not.toHaveBeenCalled();
  });

  test("dispatches the build once the planning turn ends", () => {
    const harness = createHarness();
    harness.tracker.start(plan);

    harness.turnEnded(plan.agentId);

    expect(harness.dispatchBuild).toHaveBeenCalledWith(plan);
    expect(harness.updates).toEqual([{ ...plan, building: true }]);
  });

  test("clears the marker when the build turn ends", async () => {
    const harness = createHarness();
    harness.tracker.start(plan);

    harness.turnEnded(plan.agentId);
    await Promise.resolve();
    harness.turnEnded(plan.agentId);

    expect(harness.updates).toEqual([
      { ...plan, building: true },
      { ...plan, building: false },
    ]);
  });

  test("stops tracking and reports a failed dispatch", async () => {
    const harness = createHarness();
    const error = new Error("dispatch failed");
    harness.dispatchBuild.mockRejectedValueOnce(error);
    harness.tracker.start(plan);

    harness.turnEnded(plan.agentId);
    await vi.waitFor(() => expect(harness.onDispatchError).toHaveBeenCalledWith(error, plan));
    harness.turnEnded(plan.agentId);

    expect(harness.updates).toEqual([
      { ...plan, building: true },
      { ...plan, building: false },
    ]);
  });

  test("clears the previous plan's marker when the agent starts another build", () => {
    const harness = createHarness();
    const other = { ...plan, path: "plans/other.md", title: "Other" };
    harness.tracker.start(plan);

    harness.tracker.start(other);

    expect(harness.updates).toEqual([
      { ...plan, building: true },
      { ...plan, building: false },
      { ...other, building: true },
    ]);
  });

  test("keeps other agents' builds untouched", () => {
    const harness = createHarness();
    harness.tracker.start(plan);

    harness.turnEnded("agent-2");

    expect(harness.dispatchBuild).not.toHaveBeenCalled();
    expect(harness.updates).toEqual([{ ...plan, building: true }]);
  });

  test("ignores turn events before any build starts", () => {
    const harness = createHarness();

    harness.turnEnded(plan.agentId);

    expect(harness.dispatchBuild).not.toHaveBeenCalled();
    expect(harness.updates).toEqual([]);
  });
});
