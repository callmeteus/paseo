import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { showExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";

export interface OpenPlanInput {
  serverId: string;
  workspaceId: string;
  path: string;
  isCompact: boolean;
}

/**
 * Opens a plan file in the Explorer sidebar (Ctrl+E) instead of the main workspace
 * pane, so plans read as a supporting view beside the tree. Returns the tab id.
 */
export function openPlanInExplorerSidebar(input: OpenPlanInput): string | null {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return null;
  }
  const store = useWorkspaceLayoutStore.getState();
  const paneId = showExplorerSidebar({ isCompact: input.isCompact, workspaceKey });
  const tabId = store.openTab({
    workspaceKey,
    target: { kind: "file", path: input.path },
    intent: "reveal",
    ...(paneId ? { placement: { mode: "pane" as const, paneId } } : {}),
  });
  if (tabId) {
    revealWorkspaceTab(workspaceKey, tabId);
  }
  return tabId;
}
