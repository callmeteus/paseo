import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

/**
 * Closing a tab is a layout action, not an archive action. The user can archive
 * a chat explicitly from its menu; closing the tab must not remove it from the
 * sidebar or stop its agent.
 */
export function resolveCloseAgentTabPolicy(
  _agent: Pick<Agent, "parentAgentId"> | null | undefined,
): CloseAgentTabPolicy {
  return { kind: "layout-only" };
}
