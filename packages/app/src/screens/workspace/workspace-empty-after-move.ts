import type { Agent } from "@/stores/session-store";

type WorkspaceAgent = Pick<Agent, "id" | "workspaceId" | "archivedAt">;

/**
 * Whether moving a chat out of a workspace leaves it without any chats.
 *
 * Archived chats still belong to their workspace, so they keep it non-empty. The caller decides
 * whether the workspace is known at all; this only counts the chats the store has for it.
 */
export function workspaceIsEmptyAfterMove(input: {
  agents: ReadonlyMap<string, WorkspaceAgent>;
  agentDetails?: ReadonlyMap<string, WorkspaceAgent> | undefined;
  sourceWorkspaceId: string | undefined;
  movedAgentId: string;
}): boolean {
  if (!input.sourceWorkspaceId) {
    return false;
  }
  const seen = new Set<string>();
  for (const agents of [input.agents, input.agentDetails]) {
    if (!agents) continue;
    for (const [agentId, agent] of agents) {
      if (seen.has(agentId)) continue;
      seen.add(agentId);
      if (agentId === input.movedAgentId) continue;
      if (agent.workspaceId === input.sourceWorkspaceId) {
        return false;
      }
    }
  }
  return true;
}
