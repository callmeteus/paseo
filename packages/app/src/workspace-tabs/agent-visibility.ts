import { hasOpenAgentTab, isOpenAgentTabClosed } from "@getpaseo/protocol/agent-labels";
import { getPortingActivity } from "@/composer/agent-controls/porting-activity";
import type { Agent } from "@/stores/session-store";
import type { WorkspaceTabSnapshot } from "@/stores/workspace-layout-actions";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export interface WorkspaceAgentVisibility {
  activeAgentIds: Set<string>;
  autoOpenAgentIds: Set<string>;
  /**
   * Agents whose tab was closed on any client. The daemon keeps the label, so
   * every client sees the same closed state and prunes the tab.
   */
  hiddenAgentIds: Set<string>;
  /** Agents with an open-tab label from any client; clears stale local hidden state. */
  openedAgentIds: Set<string>;
  /** The close marker's `updatedAt`, used to keep a tab reopened after the close. */
  hiddenAgentUpdatedAtById: Map<string, number>;
}

function agentBelongsToWorkspace(agent: Agent, workspaceId: string): boolean {
  return normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId;
}

function trackAgentTabLabels(input: {
  agent: Agent;
  hiddenAgentIds: Set<string>;
  openedAgentIds: Set<string>;
  hiddenAgentUpdatedAtById: Map<string, number>;
}): void {
  const { agent, hiddenAgentIds, openedAgentIds, hiddenAgentUpdatedAtById } = input;
  if (hasOpenAgentTab(agent.labels)) {
    openedAgentIds.add(agent.id);
  }
  if (isOpenAgentTabClosed(agent.labels)) {
    hiddenAgentIds.add(agent.id);
    hiddenAgentUpdatedAtById.set(agent.id, agent.updatedAt.getTime());
  }
}

export function deriveWorkspaceAgentVisibility(input: {
  serverId?: string;
  sessionAgents: Map<string, Agent> | undefined;
  agentDetails?: Map<string, Agent> | undefined;
  workspaceId: string | null | undefined;
}): WorkspaceAgentVisibility {
  const { sessionAgents, agentDetails } = input;
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if ((!sessionAgents && !agentDetails) || !workspaceId) {
    return {
      activeAgentIds: new Set<string>(),
      autoOpenAgentIds: new Set<string>(),
      hiddenAgentIds: new Set<string>(),
      openedAgentIds: new Set<string>(),
      hiddenAgentUpdatedAtById: new Map<string, number>(),
    };
  }

  const activeAgentIds = new Set<string>();
  const autoOpenAgentIds = new Set<string>();
  const hiddenAgentIds = new Set<string>();
  const openedAgentIds = new Set<string>();
  const hiddenAgentUpdatedAtById = new Map<string, number>();
  for (const agent of sessionAgents?.values() ?? []) {
    if (!agentBelongsToWorkspace(agent, workspaceId)) {
      continue;
    }
    trackAgentTabLabels({
      agent,
      hiddenAgentIds,
      openedAgentIds,
      hiddenAgentUpdatedAtById,
    });
    if (!agent.archivedAt) {
      activeAgentIds.add(agent.id);
      const parentAgent = agent.parentAgentId
        ? (sessionAgents?.get(agent.parentAgentId) ?? agentDetails?.get(agent.parentAgentId))
        : undefined;
      // A ported chat stays out of the tab bar while its source port is running,
      // even though it already carries the source's historical user messages. The
      // caller navigates to it explicitly once the port finishes.
      const source = agent.migratedFrom;
      const portSource = source
        ? getPortingActivity(source.host ?? input.serverId ?? "", source.agentId)
        : null;
      const isPendingPort = Boolean(source) && (Boolean(portSource) || !agent.lastUserMessageAt);
      if (isWorkspaceRootAgent(agent, parentAgent) && !isPendingPort) {
        autoOpenAgentIds.add(agent.id);
      }
    }
  }
  return {
    activeAgentIds,
    autoOpenAgentIds,
    hiddenAgentIds,
    openedAgentIds,
    hiddenAgentUpdatedAtById,
  };
}

interface AgentMapsSnapshot {
  sessions: Record<
    string,
    { agents: Map<string, Agent>; agentDetails: Map<string, Agent> } | undefined
  >;
}

// Session-store selectors run on every store update, including every stream tick, which
// leaves the agent maps untouched. Reuse the previous result until either map changes, and
// keep it when a recompute yields the same sets so the hook's equality check stays O(1).
export function createWorkspaceAgentVisibilitySelector(input: {
  serverId: string;
  workspaceId: string | null | undefined;
}): (state: AgentMapsSnapshot) => WorkspaceAgentVisibility {
  let previousAgents: Map<string, Agent> | undefined;
  let previousAgentDetails: Map<string, Agent> | undefined;
  let previousVisibility: WorkspaceAgentVisibility | null = null;

  return (state) => {
    const session = state.sessions[input.serverId];
    const agents = session?.agents;
    const agentDetails = session?.agentDetails;
    if (previousVisibility && agents === previousAgents && agentDetails === previousAgentDetails) {
      return previousVisibility;
    }

    const visibility = deriveWorkspaceAgentVisibility({
      serverId: input.serverId,
      sessionAgents: agents,
      agentDetails,
      workspaceId: input.workspaceId,
    });
    previousAgents = agents;
    previousAgentDetails = agentDetails;
    if (!previousVisibility || !workspaceAgentVisibilityEqual(previousVisibility, visibility)) {
      previousVisibility = visibility;
    }
    return previousVisibility;
  };
}

export function buildWorkspaceTabSnapshot(input: {
  agentVisibility: WorkspaceAgentVisibility;
  agentsHydrated: boolean;
  terminalsHydrated: boolean;
  knownTerminalIds: Iterable<string>;
  standaloneTerminalIds: Iterable<string>;
  hasActivePendingTerminalCreate: boolean;
  hasActivePendingDraftCreate: boolean;
}): WorkspaceTabSnapshot {
  return {
    agentsHydrated: input.agentsHydrated,
    terminalsHydrated: input.terminalsHydrated,
    activeAgentIds: input.agentVisibility.activeAgentIds,
    autoOpenAgentIds: input.agentVisibility.autoOpenAgentIds,
    hiddenAgentIds: input.agentVisibility.hiddenAgentIds,
    openedAgentIds: input.agentVisibility.openedAgentIds,
    hiddenAgentUpdatedAtById: input.agentVisibility.hiddenAgentUpdatedAtById,
    knownTerminalIds: input.knownTerminalIds,
    standaloneTerminalIds: input.standaloneTerminalIds,
    hasActivePendingTerminalCreate: input.hasActivePendingTerminalCreate,
    hasActivePendingDraftCreate: input.hasActivePendingDraftCreate,
  };
}

export function workspaceAgentVisibilityEqual(
  a: WorkspaceAgentVisibility,
  b: WorkspaceAgentVisibility,
): boolean {
  return (
    a === b ||
    (setsEqual(a.activeAgentIds, b.activeAgentIds) &&
      setsEqual(a.autoOpenAgentIds, b.autoOpenAgentIds) &&
      setsEqual(a.hiddenAgentIds, b.hiddenAgentIds) &&
      setsEqual(a.openedAgentIds, b.openedAgentIds))
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

// Prune agent tabs that are no longer active once agents are hydrated.
// Archived agents get pruned so that archiving on one client closes the tab on all clients.
export function shouldPruneWorkspaceAgentTab(input: {
  agentId: string;
  agentsHydrated: boolean;
  activeAgentIds: Set<string>;
}): boolean {
  if (!input.agentId.trim()) {
    return false;
  }
  if (!input.agentsHydrated) {
    return false;
  }
  return !input.activeAgentIds.has(input.agentId);
}
