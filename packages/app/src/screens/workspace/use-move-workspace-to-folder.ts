import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopHost } from "@/desktop/host";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { isWeb } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";
import { useRecommendedProjectPaths } from "@/stores/session-store-hooks";
import { useMoveWorkspaceToFolderRequest } from "@/screens/workspace/move-workspace-to-folder-store";
import { buildOpenWorkspaceFolderRows } from "@/screens/workspace/move-workspace-to-folder-options";
import { useMoveWorkspaceDirectorySearch } from "@/screens/workspace/use-move-workspace-directory-search";
import { useMoveWorkspaceRelocation } from "@/screens/workspace/use-move-workspace-relocation";
import type { WorkspaceFolderRowModel } from "@/screens/workspace/move-workspace-to-folder-options";
import type { CommandPanelSearch } from "@/components/ui/command-panel";

interface MoveWorkspaceToFolderViewModel {
  visible: boolean;
  header: {
    title: string;
    search: CommandPanelSearch;
  };
  filteredRows: WorkspaceFolderRowModel[];
  suggestionRows: WorkspaceFolderRowModel[];
  showListEmpty: boolean;
  normalizedQuery: string;
  searchPending: boolean;
  movingTo: string | null;
  canPickDirectory: boolean;
  selectWorkspace: (directory: string) => void;
  pickAnotherFolder: () => void;
}

export function useMoveWorkspaceToFolder(): MoveWorkspaceToFolderViewModel {
  const { t } = useTranslation();
  const request = useMoveWorkspaceToFolderRequest();
  const client = useSessionStore((state) =>
    request ? (state.sessions[request.serverId]?.client ?? null) : null,
  );
  const workspaces = useSessionStore((state) =>
    request ? state.sessions[request.serverId]?.workspaces : undefined,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResetKey, setSearchResetKey] = useState(0);
  const current = request && workspaces ? workspaces.get(request.workspaceId) : undefined;
  const isLocalDaemon = useIsLocalDaemon(request?.serverId ?? "");
  const canPickDirectory = Boolean(getDesktopHost()?.dialog && isLocalDaemon);
  const visible = Boolean(request && client && current);
  const recommendedPaths = useRecommendedProjectPaths(request?.serverId ?? null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!visible) {
      setSearchQuery("");
      setDebouncedQuery("");
      return;
    }
    setSearchQuery("");
    setDebouncedQuery("");
    setSearchResetKey((key) => key + 1);
  }, [request?.serverId, request?.workspaceId, visible]);

  const header = useMemo(
    () => ({
      title: t("workspace.tabs.menu.moveWorkspace.title"),
      search: {
        onChangeText: setSearchQuery,
        resetKey: `${request?.workspaceId ?? "closed"}:${searchResetKey}`,
        placeholder: t("workspace.tabs.menu.moveWorkspace.searchPlaceholder"),
        autoFocus: isWeb,
        testID: "move-workspace-to-folder-search",
      },
    }),
    [request?.workspaceId, searchResetKey, t],
  );

  const rows = useMemo(
    () => buildOpenWorkspaceFolderRows(workspaces, current?.workspaceDirectory),
    [current?.workspaceDirectory, workspaces],
  );

  const listState = useMoveWorkspaceDirectorySearch({
    client,
    serverId: request?.serverId,
    visible,
    searchQuery,
    debouncedQuery,
    rows,
    recommendedPaths,
    currentDirectory: current?.workspaceDirectory,
  });

  const { movingTo, setMovingTo, selectWorkspace, pickAnotherFolder } = useMoveWorkspaceRelocation({
    client,
    current,
    request,
    canPickDirectory,
    rows,
  });

  useEffect(() => {
    if (!visible) setMovingTo(null);
  }, [setMovingTo, visible]);

  return {
    visible,
    header,
    filteredRows: listState.filteredRows,
    suggestionRows: listState.suggestionRows,
    showListEmpty: listState.showListEmpty,
    normalizedQuery: listState.normalizedQuery,
    searchPending: listState.searchPending,
    movingTo,
    canPickDirectory,
    selectWorkspace,
    pickAnotherFolder,
  };
}
