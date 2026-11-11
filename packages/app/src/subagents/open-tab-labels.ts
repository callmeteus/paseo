import {
  isOpenAgentTabClosed,
  isOpenAgentTabLabel,
  OPEN_AGENT_TAB_LABEL,
} from "@getpaseo/protocol/agent-labels";
import type { Agent } from "@/stores/session-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";

export function getAgentTabsNeedingOpenLabel(input: {
  tabs: WorkspaceTab[];
  getAgent: (agentId: string) => Agent | null | undefined;
  labels: string[];
  pendingAgentIds: ReadonlySet<string>;
}): string[] {
  const latestTabCreatedAtByAgentId = new Map<string, number>();
  for (const tab of input.tabs) {
    if (tab.target.kind !== "agent") {
      continue;
    }
    const current = latestTabCreatedAtByAgentId.get(tab.target.agentId);
    if (current === undefined || tab.createdAt > current) {
      latestTabCreatedAtByAgentId.set(tab.target.agentId, tab.createdAt);
    }
  }

  const agentIds = new Set<string>();
  for (const tab of input.tabs) {
    if (tab.target.kind !== "agent") {
      continue;
    }
    const agent = input.getAgent(tab.target.agentId);
    if (!agent) {
      continue;
    }
    if (input.labels.every((label) => agent.labels[label] === "true")) {
      continue;
    }
    if (input.pendingAgentIds.has(agent.id)) {
      continue;
    }
    // A restored tab older than the daemon's close marker is about to be
    // pruned; marking it open would reopen it on the client that closed it.
    if (
      isOpenAgentTabClosed(agent.labels) &&
      (latestTabCreatedAtByAgentId.get(agent.id) ?? 0) <= agent.updatedAt.getTime()
    ) {
      continue;
    }
    agentIds.add(agent.id);
  }
  return [...agentIds];
}

/**
 * Marks the agent tab closed for every client: the global marker closes the tab
 * on current clients, and the client-scoped markers are cleared so older
 * clients also stop reporting it open. Labels cannot be removed through the
 * update-agent RPC, so existing open-tab labels are set to `"false"`.
 */
export function buildCloseAgentTabLabels(
  labels: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const patch: Record<string, string> = { [OPEN_AGENT_TAB_LABEL]: "false" };
  for (const label of Object.keys(labels ?? {})) {
    if (isOpenAgentTabLabel(label)) {
      patch[label] = "false";
    }
  }
  return patch;
}
