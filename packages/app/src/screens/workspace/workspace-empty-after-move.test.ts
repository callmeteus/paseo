import { describe, expect, it } from "vitest";
import { workspaceIsEmptyAfterMove } from "./workspace-empty-after-move";

function agents(...entries: Array<{ id: string; workspaceId?: string; archivedAt?: Date | null }>) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

describe("workspaceIsEmptyAfterMove", () => {
  it("reports empty when the moved chat was the only one", () => {
    expect(
      workspaceIsEmptyAfterMove({
        agents: agents({ id: "moved", workspaceId: "workspace-a" }),
        sourceWorkspaceId: "workspace-a",
        movedAgentId: "moved",
      }),
    ).toBe(true);
  });

  it("keeps the workspace when another chat still lives there", () => {
    expect(
      workspaceIsEmptyAfterMove({
        agents: agents(
          { id: "moved", workspaceId: "workspace-a" },
          { id: "stays", workspaceId: "workspace-a" },
        ),
        sourceWorkspaceId: "workspace-a",
        movedAgentId: "moved",
      }),
    ).toBe(false);
  });

  it("counts archived chats because they still belong to the workspace", () => {
    expect(
      workspaceIsEmptyAfterMove({
        agents: agents(
          { id: "moved", workspaceId: "workspace-a" },
          { id: "archived", workspaceId: "workspace-a", archivedAt: new Date(0) },
        ),
        sourceWorkspaceId: "workspace-a",
        movedAgentId: "moved",
      }),
    ).toBe(false);
  });

  it("finds chats that only the agent detail map knows about", () => {
    expect(
      workspaceIsEmptyAfterMove({
        agents: agents({ id: "moved", workspaceId: "workspace-a" }),
        agentDetails: agents({ id: "detailed", workspaceId: "workspace-a" }),
        sourceWorkspaceId: "workspace-a",
        movedAgentId: "moved",
      }),
    ).toBe(false);
  });

  it("does not warn when the source workspace is unknown", () => {
    expect(
      workspaceIsEmptyAfterMove({
        agents: agents({ id: "moved", workspaceId: undefined }),
        sourceWorkspaceId: undefined,
        movedAgentId: "moved",
      }),
    ).toBe(false);
  });
});
