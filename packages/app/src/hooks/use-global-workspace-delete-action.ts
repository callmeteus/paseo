import { useCallback } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useHostFeature } from "@/runtime/host-features";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { useWorkspaceDelete } from "@/workspace/use-workspace-delete";

const WORKSPACE_DELETE_ACTIONS: readonly KeyboardActionId[] = ["workspace.delete"];

/**
 * Like archive and pin, the delete shortcut is global: a collapsed project or status group,
 * a hidden sidebar, or focus mode must not take it away. It uses the active route selection
 * and calls the same hook as the menu item, so the key always opens the permanent-delete
 * confirmation and never removes a workspace silently.
 */
export function useGlobalWorkspaceDeleteAction() {
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const routeWorkspaceId = selection?.workspaceId ?? null;
  // `id` is the descriptor id, not the route id; see use-global-workspace-pin-action.ts.
  const fields = useWorkspaceFields(serverId, routeWorkspaceId, (workspace) => ({
    id: workspace.id,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
  }));

  const supportsDelete = useHostFeature(serverId, "workspaceDelete");
  const activeWorkspaceId = fields?.id ?? null;
  const redirectAfterDelete = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: serverId ?? "",
      workspaceId: activeWorkspaceId ?? routeWorkspaceId ?? "",
      activeWorkspaceSelection:
        serverId && activeWorkspaceId ? { serverId, workspaceId: activeWorkspaceId } : null,
    });
  }, [activeWorkspaceId, routeWorkspaceId, serverId]);

  const deleteController = useWorkspaceDelete({
    serverId: serverId ?? "",
    workspaceId: activeWorkspaceId ?? "",
    workspaceKind: fields?.workspaceKind ?? "directory",
    name: fields?.name ?? "",
    onDeleted: redirectAfterDelete,
  });

  const canDelete = supportsDelete && fields !== null;

  const handle = useCallback(() => {
    if (!canDelete || !serverId) return false;
    deleteController.deleteWorkspace();
    return true;
  }, [canDelete, deleteController, serverId]);

  useKeyboardActionHandler({
    handlerId: "workspace-delete-global",
    actions: WORKSPACE_DELETE_ACTIONS,
    enabled: canDelete,
    priority: 0,
    handle,
  });
}
