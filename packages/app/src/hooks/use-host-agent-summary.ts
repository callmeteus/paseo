import { useMemo } from "react";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import {
  aggregateSidebarStateBuckets,
  deriveSidebarStateBucket,
  type SidebarAttentionReason,
  type SidebarStateBucket,
} from "@/utils/sidebar-agent-state";
import { workspaceAgentStatus } from "@/utils/workspace-agent-activity";

export interface HostAgentSummary {
  /** Root agents actively working on this host. */
  runningCount: number;
  /** The single most urgent bucket on this host, or null when there are no agents. */
  dominantBucket: SidebarStateBucket | null;
  /** Why the host needs attention, when it does. */
  attentionReason: SidebarAttentionReason;
  /** At least one agent finished and is still unread. */
  hasFinished: boolean;
}

const EMPTY_SUMMARY: HostAgentSummary = {
  runningCount: 0,
  dominantBucket: null,
  attentionReason: null,
  hasFinished: false,
};

/**
 * Aggregate the root agents of one host into the state its top tab shows.
 *
 * Archived agents and subagents are excluded, matching the workspace activity
 * index. The bucket order is the sidebar's collapse order: needs_input and
 * failed outrank running, which outranks an unread finish, which outranks done.
 */
export function summarizeHostAgents(agents: ReadonlyMap<string, Agent>): HostAgentSummary {
  const buckets: SidebarStateBucket[] = [];
  let runningCount = 0;
  let hasFinished = false;
  let attentionReason: SidebarAttentionReason = null;

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    const bucket = deriveSidebarStateBucket({
      status: workspaceAgentStatus(agent),
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    buckets.push(bucket);
    if (bucket === "running") {
      runningCount += 1;
    }
    if (agent.requiresAttention && attentionReason === null) {
      attentionReason = agent.attentionReason ?? null;
    }
    if (agent.requiresAttention && agent.attentionReason === "finished") {
      hasFinished = true;
    }
  }

  if (buckets.length === 0) {
    return EMPTY_SUMMARY;
  }
  return {
    runningCount,
    dominantBucket: aggregateSidebarStateBuckets(buckets),
    attentionReason,
    hasFinished,
  };
}

export function useHostAgentSummary(serverId: string): HostAgentSummary {
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  return useMemo(() => (agents ? summarizeHostAgents(agents) : EMPTY_SUMMARY), [agents]);
}
