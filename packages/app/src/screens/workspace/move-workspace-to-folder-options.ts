import { buildProjectPickerOptions } from "@/components/project-picker-options";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export interface WorkspaceFolderRowModel {
  directory: string;
  name: string;
  project: string | null;
  isCurrent: boolean;
}

export function folderName(directory: string): string {
  const segments = directory.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? directory;
}

export function normalizeFilterQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function workspaceRowMatchesQuery(row: WorkspaceFolderRowModel, query: string): boolean {
  if (!query) return true;
  const haystack = `${row.name}\n${row.project ?? ""}\n${row.directory}`.toLowerCase();
  return haystack.includes(query);
}

export function buildOpenWorkspaceFolderRows(
  workspaces: Map<string, WorkspaceDescriptor> | undefined,
  currentDirectory: string | undefined,
): WorkspaceFolderRowModel[] {
  const byDirectory = new Map<string, WorkspaceFolderRowModel>();
  for (const workspace of workspaces?.values() ?? []) {
    if (workspace.archivingAt || byDirectory.has(workspace.workspaceDirectory)) continue;
    byDirectory.set(workspace.workspaceDirectory, {
      directory: workspace.workspaceDirectory,
      name: folderName(workspace.workspaceDirectory),
      project: workspace.projectDisplayName,
      isCurrent: workspace.workspaceDirectory === currentDirectory,
    });
  }
  return [...byDirectory.values()].sort((left, right) => {
    if (left.isCurrent) return -1;
    if (right.isCurrent) return 1;
    return left.name.localeCompare(right.name);
  });
}

export function buildDirectorySuggestionRows(input: {
  debouncedQuery: string;
  serverPaths: string[];
  recommendedPaths: string[];
  openDirectories: string[];
  currentDirectory: string | undefined;
}): WorkspaceFolderRowModel[] {
  if (!input.debouncedQuery.trim()) return [];
  const openPaths = new Set(input.openDirectories);
  const options = buildProjectPickerOptions({
    recommendedPaths: input.recommendedPaths,
    serverPaths: input.serverPaths,
    query: input.debouncedQuery,
  });
  return options
    .map((option) => option.path)
    .filter((path) => !openPaths.has(path) && path !== input.currentDirectory)
    .map((directory) => ({
      directory,
      name: folderName(directory),
      project: null,
      isCurrent: false,
    }));
}
