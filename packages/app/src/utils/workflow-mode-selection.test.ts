import { describe, expect, it } from "vitest";
import { acceptAgentDirectoryUpdate } from "./agent-directory-update-policy";
import { reduceWorkflowModeSelection, type WorkflowModeSelection } from "./workflow-mode-selection";

describe("reduceWorkflowModeSelection", () => {
  it("keeps the chosen mode when an older snapshot arrives after send", () => {
    let state: WorkflowModeSelection = { modeId: "debug", revision: 0 };
    state = reduceWorkflowModeSelection(state, { type: "choose", modeId: "multitask" });
    state = reduceWorkflowModeSelection(state, { type: "send" });
    state = reduceWorkflowModeSelection(state, { type: "snapshot", modeId: "debug" });
    expect(state).toEqual({ modeId: "multitask", revision: 1 });
  });

  it("does not undo a mid-turn choice when the turn snapshot still has the previous mode", () => {
    let state = reduceWorkflowModeSelection(
      { modeId: "debug", revision: 0 },
      { type: "choose", modeId: "multitask" },
    );
    state = reduceWorkflowModeSelection(state, { type: "choose", modeId: "plan" });
    state = reduceWorkflowModeSelection(state, { type: "snapshot", modeId: "multitask" });
    expect(state).toEqual({ modeId: "plan", revision: 2 });
  });

  it("applies a newer server confirmation over the latched choice", () => {
    const chosen = reduceWorkflowModeSelection(
      { modeId: "debug", revision: 0 },
      { type: "choose", modeId: "multitask" },
    );
    const state = reduceWorkflowModeSelection(chosen, {
      type: "confirm",
      modeId: "plan",
      revision: 2,
    });
    expect(state).toEqual({ modeId: "plan", revision: 2 });
  });

  it("lets the matching RPC confirmation normalize the mode", () => {
    const state = reduceWorkflowModeSelection(
      { modeId: "multitask", revision: 1 },
      { type: "confirm", modeId: "agent", revision: 1 },
    );
    expect(state).toEqual({ modeId: "agent", revision: 1 });
  });

  it("ignores a confirmation for an older choice", () => {
    const state = reduceWorkflowModeSelection(
      { modeId: "plan", revision: 2 },
      { type: "confirm", modeId: "debug", revision: 1 },
    );
    expect(state).toEqual({ modeId: "plan", revision: 2 });
  });

  it("restores the previous mode when that choice is rejected", () => {
    const chosen = reduceWorkflowModeSelection(
      { modeId: "debug", revision: 0 },
      { type: "choose", modeId: "multitask" },
    );
    const state = reduceWorkflowModeSelection(chosen, {
      type: "reject",
      revision: chosen.revision,
      modeId: "debug",
    });
    expect(state).toEqual({ modeId: "debug", revision: 0 });
  });

  it("does not roll back a newer choice when an older request fails", () => {
    let state = reduceWorkflowModeSelection(
      { modeId: "debug", revision: 0 },
      { type: "choose", modeId: "multitask" },
    );
    state = reduceWorkflowModeSelection(state, { type: "choose", modeId: "plan" });
    state = reduceWorkflowModeSelection(state, {
      type: "reject",
      revision: 1,
      modeId: "debug",
    });
    expect(state).toEqual({ modeId: "plan", revision: 2 });
  });

  it("still takes a snapshot when the user has not chosen a mode", () => {
    const state = reduceWorkflowModeSelection(
      { modeId: "debug", revision: 0 },
      { type: "snapshot", modeId: "ask" },
    );
    expect(state).toEqual({ modeId: "ask", revision: 0 });
  });
});

describe("acceptAgentDirectoryUpdate workflow mode", () => {
  it("keeps the chosen mode when a newer snapshot still carries the previous one", () => {
    const current = {
      updatedAt: "2026-11-05T19:00:00.000Z",
      workflowModeId: "multitask",
      workflowModeRevision: 1,
    };
    const incoming = {
      updatedAt: "2026-11-05T19:02:54.000Z",
      workflowModeId: "debug",
    };
    expect(acceptAgentDirectoryUpdate(current, incoming)).toMatchObject({
      updatedAt: incoming.updatedAt,
      workflowModeId: "multitask",
      workflowModeRevision: 1,
    });
  });

  it("still accepts a directory snapshot before the user chooses a mode", () => {
    const current = {
      updatedAt: "2026-11-05T19:00:00.000Z",
      workflowModeId: "debug",
    };
    const incoming = {
      updatedAt: "2026-11-05T19:02:54.000Z",
      workflowModeId: "ask",
    };
    expect(acceptAgentDirectoryUpdate(current, incoming)).toBe(incoming);
  });

  it("accepts a snapshot that confirms a newer workflow mode revision", () => {
    const current = {
      updatedAt: "2026-11-05T19:00:00.000Z",
      workflowModeId: "multitask",
      workflowModeRevision: 1,
    };
    const incoming = {
      updatedAt: "2026-11-05T19:03:00.000Z",
      workflowModeId: "plan",
      workflowModeRevision: 2,
    };
    expect(acceptAgentDirectoryUpdate(current, incoming)).toBe(incoming);
  });
});
