import { describe, expect, it } from "vitest";
import { resolveWorkspaceTabDrop } from "./workspace-tab-drag-policy";

const sidebarTarget = {
  workspaceKey: "server:workspace-b",
  workspaceId: "workspace-b",
  agentId: "agent-1",
};

describe("resolveWorkspaceTabDrop", () => {
  it("drops onto the sidebar workspace even when a pane is the closest dnd-kit target", () => {
    // The pointer is over the sidebar, where dnd-kit still reports the nearest pane. The sidebar
    // row has to win or the drop resolves against a pane behind the sidebar and nothing happens.
    expect(
      resolveWorkspaceTabDrop({
        sidebarTarget,
        sourcePaneId: "pane-a",
        over: { kind: "split-pane-drop", paneId: "pane-a" },
        allowCrossPane: true,
      }),
    ).toEqual({ kind: "workspace", ...sidebarTarget });
  });

  it("reorders inside a pane when no sidebar row is under the pointer", () => {
    expect(
      resolveWorkspaceTabDrop({
        sidebarTarget: null,
        sourcePaneId: "pane-a",
        over: { kind: "workspace-tab", paneId: "pane-a" },
        allowCrossPane: false,
      }),
    ).toEqual({ kind: "tab" });
  });

  it("splits a pane when no sidebar row is under the pointer", () => {
    expect(
      resolveWorkspaceTabDrop({
        sidebarTarget: null,
        sourcePaneId: "pane-a",
        over: { kind: "split-pane-drop", paneId: "pane-b" },
        allowCrossPane: true,
      }),
    ).toEqual({ kind: "pane" });
  });

  it("ignores a cross-pane target when cross-pane drops are disabled", () => {
    expect(
      resolveWorkspaceTabDrop({
        sidebarTarget: null,
        sourcePaneId: "pane-a",
        over: { kind: "split-pane-drop", paneId: "pane-b" },
        allowCrossPane: false,
      }),
    ).toBeNull();
  });

  it("does nothing without a source pane or a target", () => {
    expect(
      resolveWorkspaceTabDrop({
        sidebarTarget: null,
        sourcePaneId: null,
        over: { kind: "workspace-tab", paneId: "pane-a" },
        allowCrossPane: true,
      }),
    ).toBeNull();
    expect(
      resolveWorkspaceTabDrop({
        sidebarTarget: null,
        sourcePaneId: "pane-a",
        over: null,
        allowCrossPane: true,
      }),
    ).toBeNull();
  });
});
