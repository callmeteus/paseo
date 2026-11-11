import type { AgentAddress } from "./addresses.js";
export const PARENT_SERVER_ID_LABEL = "paseo.parent-server-id";
export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
/**
 * Marks an agent whose timeline was imported from another product instead of
 * a provider session. `sourceId` is the source's own stable chat id, so a
 * re-import can find the existing agent.
 */
export const IMPORT_SOURCE_LABEL = "paseo.import.source";
export const IMPORT_SOURCE_ID_LABEL = "paseo.import.source-id";
/** Model the chat used in the source product, kept for continuation mapping. */
export const IMPORT_MODEL_LABEL = "paseo.import.model";
/**
 * Global open-tab marker shared by every client connected to the same host.
 * Per-client labels still exist for older clients; the global label is the
 * authoritative one for current clients.
 */
export const OPEN_AGENT_TAB_LABEL = "paseo.open-agent-tab";
const OPEN_AGENT_TAB_LABEL_PREFIX = `${OPEN_AGENT_TAB_LABEL}.`;

export function getImportSourceFromLabels(
  labels: Record<string, unknown> | null | undefined,
): string | null {
  const source = labels?.[IMPORT_SOURCE_LABEL];
  return typeof source === "string" && source.trim().length > 0 ? source.trim() : null;
}

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label === OPEN_AGENT_TAB_LABEL || label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

/**
 * A tab is closed when the global label says so and no client-scoped label
 * still reports it open. Missing labels mean "never explicitly closed", so
 * agents created before the global marker stay visible.
 */
export function isOpenAgentTabClosed(labels: Record<string, unknown> | null | undefined): boolean {
  if (labels?.[OPEN_AGENT_TAB_LABEL] !== "false") {
    return false;
  }
  return !Object.entries(labels ?? {}).some(
    ([label, value]) => label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX) && value === "true",
  );
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}

// Absent parent server label means the same host.
export function getParentAddressFromLabels(
  labels: Record<string, unknown> | null | undefined,
  serverId: string,
): AgentAddress | null {
  const agentId = getParentAgentIdFromLabels(labels);
  if (!agentId) return null;
  const parentServerId = labels?.[PARENT_SERVER_ID_LABEL];
  return {
    serverId:
      typeof parentServerId === "string" && parentServerId.trim()
        ? parentServerId.trim()
        : serverId,
    agentId,
  };
}
export function parentAddressLabels(parent: AgentAddress): Record<string, string> {
  return { [PARENT_AGENT_ID_LABEL]: parent.agentId, [PARENT_SERVER_ID_LABEL]: parent.serverId };
}
