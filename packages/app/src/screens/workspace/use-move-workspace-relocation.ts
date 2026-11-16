import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import {
  requestSidebarReveal,
  workspaceKeyForSidebarRow,
} from "@/components/sidebar/sidebar-reveal";
import { getDesktopHost } from "@/desktop/host";
import { pickDirectory } from "@/desktop/pick-directory";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { closeMoveWorkspaceToFolder } from "@/screens/workspace/move-workspace-to-folder-store";
import type { MoveWorkspaceRequest } from "@/screens/workspace/move-workspace-to-folder-store";
import type { WorkspaceFolderRowModel } from "@/screens/workspace/move-workspace-to-folder-options";

interface UseMoveWorkspaceRelocationInput {
  client: DaemonClient | null;
  current: WorkspaceDescriptor | undefined;
  request: MoveWorkspaceRequest | null;
  canPickDirectory: boolean;
  rows: WorkspaceFolderRowModel[];
}

export function useMoveWorkspaceRelocation({
  client,
  current,
  request,
  canPickDirectory,
  rows,
}: UseMoveWorkspaceRelocationInput) {
  const { t } = useTranslation();
  const toast = useToast();
  const [movingTo, setMovingTo] = useState<string | null>(null);

  const relocate = useCallback(
    async (targetPath: string, rowId: string) => {
      if (!client || !current || !request || movingTo) return;
      setMovingTo(rowId);
      try {
        await client.relocateWorkspace(current.id, targetPath);
        requestSidebarReveal(
          workspaceKeyForSidebarRow({ serverId: request.serverId, workspaceId: current.id }),
        );
        toast.show(t("workspace.tabs.menu.moveWorkspace.moved", { path: targetPath }), {
          variant: "info",
        });
        closeMoveWorkspaceToFolder();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.menu.moveWorkspace.failed"),
        );
      } finally {
        setMovingTo(null);
      }
    },
    [client, current, movingTo, request, t, toast],
  );

  const selectWorkspace = useCallback(
    (directory: string) => {
      const openRow = rows.find((row) => row.directory === directory);
      if (openRow?.isCurrent) return;
      void relocate(directory, directory);
    },
    [relocate, rows],
  );

  const pickAnotherFolder = useCallback(() => {
    if (movingTo || !canPickDirectory) return;
    void (async () => {
      try {
        const path = await pickDirectory(getDesktopHost()?.dialog ?? null);
        if (!path) return;
        await relocate(path, "__picked__");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.menu.moveWorkspace.failed"),
        );
      }
    })();
  }, [canPickDirectory, movingTo, relocate, t, toast]);

  return { movingTo, setMovingTo, selectWorkspace, pickAnotherFolder };
}
