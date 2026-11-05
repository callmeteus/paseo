import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export interface DeleteWorkspaceInput {
  serverId: string;
  workspaceId: string;
  workspaceKind: WorkspaceDescriptor["workspaceKind"];
  name: string;
  onDeleted: () => void;
  onSetDeleting?: (deleting: boolean) => void;
}

export function useWorkspaceDelete(input: DeleteWorkspaceInput): { deleteWorkspace: () => void } {
  const { t } = useTranslation();
  const toast = useToast();
  const { name, serverId, workspaceId, workspaceKind, onDeleted, onSetDeleting } = input;

  const runDelete = useCallback(async () => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
      return;
    }
    onSetDeleting?.(true);
    try {
      onDeleted();
      await client.deleteWorkspace(workspaceId, {
        // Only Paseo-owned worktrees are removed from disk; the daemon enforces ownership.
        deleteFiles: workspaceKind === "worktree",
      });
      try {
        getHostRuntimeStore().removeWorkspaceSnapshot(serverId, workspaceId);
      } catch {
        // The host runtime may not have a directory yet; the refetch settles it.
      }
      const workspaceKey = buildWorkspaceTabPersistenceKey({
        serverId,
        workspaceId,
      });
      if (workspaceKey) {
        useWorkspaceLayoutStore.getState().purgeWorkspace(workspaceKey);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.deleteFailed"),
      );
    } finally {
      onSetDeleting?.(false);
    }
  }, [onDeleted, onSetDeleting, serverId, t, toast, workspaceId, workspaceKind]);
  const deleteWorkspace = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("sidebar.workspace.confirmations.deleteTitle"),
        message: t("sidebar.workspace.confirmations.deleteMessage", {
          name,
        }),
        confirmLabel: t("sidebar.workspace.confirmations.deleteConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      await runDelete();
    })();
  }, [name, runDelete, t]);

  return { deleteWorkspace };
}
