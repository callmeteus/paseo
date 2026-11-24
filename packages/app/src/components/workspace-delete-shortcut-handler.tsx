import { useGlobalWorkspaceDeleteAction } from "@/hooks/use-global-workspace-delete-action";

// Headless host for the delete shortcut, kept out of the root layout for the same reason as
// WorkspaceArchiveShortcutHandler: the hook subscribes to the active workspace's fields.
export function WorkspaceDeleteShortcutHandler() {
  useGlobalWorkspaceDeleteAction();
  return null;
}
