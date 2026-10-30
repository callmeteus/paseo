import { describe, expect, it } from "vitest";
import {
  promoteAgentToWorkspace,
  type PromoteAgentToWorkspaceClient,
} from "./promote-agent-to-workspace";

function createClient(
  overrides: Partial<PromoteAgentToWorkspaceClient> = {},
): PromoteAgentToWorkspaceClient & {
  detached: string[];
  created: Array<Parameters<PromoteAgentToWorkspaceClient["createWorkspace"]>[0]>;
  assigned: Array<{ agentId: string; workspaceId: string }>;
} {
  const detached: string[] = [];
  const created: Array<Parameters<PromoteAgentToWorkspaceClient["createWorkspace"]>[0]> = [];
  const assigned: Array<{ agentId: string; workspaceId: string }> = [];
  return {
    detached,
    created,
    assigned,
    detachAgent: async (agentId) => {
      detached.push(agentId);
    },
    createWorkspace: async (input) => {
      created.push(input);
      return { workspace: { id: "workspace-new", name: "New workspace", title: null } };
    },
    setAgentWorkspace: async (agentId, workspaceId) => {
      assigned.push({ agentId, workspaceId });
    },
    ...overrides,
  };
}

describe("promoteAgentToWorkspace", () => {
  it("always creates a fresh workspace, even when one already occupies the cwd", async () => {
    const client = createClient();

    const promoted = await promoteAgentToWorkspace({
      client,
      agent: { id: "agent", cwd: "/repo", title: "Focused chat" },
    });

    expect(client.created).toEqual([
      { source: { kind: "directory", path: "/repo" }, title: "Focused chat" },
    ]);
    expect(client.assigned).toEqual([{ agentId: "agent", workspaceId: "workspace-new" }]);
    expect(promoted).toEqual({ workspaceId: "workspace-new", workspaceName: "New workspace" });
  });

  it("detaches a subagent before giving it a workspace", async () => {
    const client = createClient();

    await promoteAgentToWorkspace({
      client,
      agent: { id: "child", cwd: "/repo", parentAgentId: "parent" },
    });

    expect(client.detached).toEqual(["child"]);
    expect(client.created[0]).toEqual({ source: { kind: "directory", path: "/repo" } });
  });

  it("omits a blank title and leaves the agent untouched without a workspace", async () => {
    const client = createClient({
      createWorkspace: async (input) => {
        client.created.push(input);
        return {};
      },
    });

    const promoted = await promoteAgentToWorkspace({
      client,
      agent: { id: "agent", cwd: "/repo", title: "   " },
    });

    expect(promoted).toBeNull();
    expect(client.created[0]).toEqual({ source: { kind: "directory", path: "/repo" } });
    expect(client.assigned).toEqual([]);
  });
});
