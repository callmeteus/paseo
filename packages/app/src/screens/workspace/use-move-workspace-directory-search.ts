import { useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import {
  buildDirectorySuggestionRows,
  normalizeFilterQuery,
  workspaceRowMatchesQuery,
  type WorkspaceFolderRowModel,
} from "@/screens/workspace/move-workspace-to-folder-options";

interface UseMoveWorkspaceDirectorySearchInput {
  client: DaemonClient | null;
  serverId: string | undefined;
  visible: boolean;
  searchQuery: string;
  debouncedQuery: string;
  rows: WorkspaceFolderRowModel[];
  recommendedPaths: string[];
  currentDirectory: string | undefined;
}

export function useMoveWorkspaceDirectorySearch({
  client,
  serverId,
  visible,
  searchQuery,
  debouncedQuery,
  rows,
  recommendedPaths,
  currentDirectory,
}: UseMoveWorkspaceDirectorySearchInput) {
  const normalizedQuery = useMemo(() => normalizeFilterQuery(searchQuery), [searchQuery]);
  const filteredRows = useMemo(
    () => rows.filter((row) => workspaceRowMatchesQuery(row, normalizedQuery)),
    [normalizedQuery, rows],
  );

  const directoryQuery = useFetchQuery({
    queryKey: ["move-workspace-to-folder-directories", serverId, debouncedQuery],
    queryFn: async () => fetchMoveWorkspaceDirectoryPaths(client, debouncedQuery),
    enabled: Boolean(client && visible && debouncedQuery.trim().length > 0),
    dataShape: "value",
    retry: false,
    staleTimeMs: 15_000,
  });

  const serverPaths = useMemo(() => {
    if (directoryQuery.data?.query !== debouncedQuery) return [];
    return directoryQuery.data.paths;
  }, [debouncedQuery, directoryQuery.data]);

  const suggestionRows = useMemo(
    () =>
      buildDirectorySuggestionRows({
        debouncedQuery,
        serverPaths,
        recommendedPaths,
        openDirectories: rows.map((row) => row.directory),
        currentDirectory,
      }),
    [currentDirectory, debouncedQuery, recommendedPaths, rows, serverPaths],
  );

  const searchPending =
    debouncedQuery.trim().length > 0 &&
    (searchQuery.trim() !== debouncedQuery || directoryQuery.isFetching);
  const showListEmpty = filteredRows.length === 0 && suggestionRows.length === 0 && !searchPending;

  return { normalizedQuery, filteredRows, suggestionRows, searchPending, showListEmpty };
}

async function fetchMoveWorkspaceDirectoryPaths(
  client: DaemonClient | null,
  debouncedQuery: string,
): Promise<{ query: string; paths: string[] }> {
  if (!client) return { query: debouncedQuery, paths: [] };
  const payload = await client.getDirectorySuggestions({
    query: debouncedQuery,
    includeDirectories: true,
    includeFiles: false,
    limit: 30,
  });
  return {
    query: debouncedQuery,
    paths:
      payload.entries?.flatMap((entry) => (entry.kind === "directory" ? [entry.path] : [])) ?? [],
  };
}
