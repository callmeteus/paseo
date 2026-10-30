import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export interface PromoteAgentToWorkspaceAgent {
  id: string;
  cwd: string;
  title?: string | null;
  parentAgentId?: string | null;
}

export interface PromoteAgentToWorkspaceWorkspace {
  id: string;
  name: string;
  title?: string | null;
}

export interface PromoteAgentToWorkspaceClient {
  detachAgent(agentId: string): Promise<unknown>;
  createWorkspace(input: {
    source: { kind: "directory"; path: string };
    title?: string;
  }): Promise<{ workspace?: PromoteAgentToWorkspaceWorkspace | null }>;
  setAgentWorkspace(agentId: string, workspaceId: string): Promise<void>;
}

export interface PromotedAgentWorkspace {
  workspaceId: string;
  workspaceName: string;
}

function workspaceDisplayName(workspace: PromoteAgentToWorkspaceWorkspace): string {
  return workspace.title?.trim() || workspace.name;
}

/**
 * Gives an agent its own workspace at its current directory. Promotion always
 * mints a fresh workspace, even when another one already occupies the same cwd:
 * reusing it would turn promotion into a plain move and leave the chat in place.
 * Subagents are detached first so the promoted chat stops being a child.
 */
export async function promoteAgentToWorkspace(input: {
  client: PromoteAgentToWorkspaceClient;
  agent: PromoteAgentToWorkspaceAgent;
}): Promise<PromotedAgentWorkspace | null> {
  const { client, agent } = input;
  if (agent.parentAgentId) {
    await client.detachAgent(agent.id);
  }
  const title = agent.title?.trim();
  const created = await client.createWorkspace({
    source: { kind: "directory", path: agent.cwd },
    ...(title ? { title } : {}),
  });
  if (!created.workspace) {
    return null;
  }
  const workspaceId = normalizeWorkspaceOpaqueId(created.workspace.id) ?? created.workspace.id;
  await client.setAgentWorkspace(agent.id, workspaceId);
  return {
    workspaceId,
    workspaceName: workspaceDisplayName(created.workspace),
  };
}
