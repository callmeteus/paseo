import { restoreWindowsFilePath } from "@/utils/path";
import {
  isWorkspaceRootPath,
  resolveWorkspaceFilePaths,
  type WorkspaceFileLocation,
} from "@/workspace/file-open";

interface FormatFileLinkTooltipPathInput {
  target: WorkspaceFileLocation;
  workspaceRoot?: string;
}

export function formatFileLinkTooltipPath({
  target,
  workspaceRoot,
}: FormatFileLinkTooltipPathInput): string {
  const isWorkspaceRoot = workspaceRoot
    ? isWorkspaceRootPath({ path: target.path, workspaceRoot })
    : false;
  const windowsPath = isWorkspaceRoot ? null : restoreWindowsFilePath(target.path);
  const resolvedPaths =
    windowsPath || !workspaceRoot
      ? null
      : resolveWorkspaceFilePaths({ path: target.path, workspaceRoot });
  let result = isWorkspaceRoot ? "." : (windowsPath ?? resolvedPaths?.relativePath ?? target.path);
  if (target.lineStart) {
    result += `:${target.lineStart}`;
    if (target.lineEnd && target.lineEnd !== target.lineStart) {
      result += `-${target.lineEnd}`;
    }
  }
  return result;
}
