import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { resolveWorkspacePath } from "@/utils/path";
import type { Theme } from "@/styles/theme";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

interface OpenInFileManagerMenuItemProps {
  path?: string | null;
  serverId?: string | null;
  workspaceId?: string | null;
  testID: string;
  surface?: "context" | "dropdown";
  /** Override the menu label; defaults to "Open in file manager". */
  label?: string;
}

const ThemedFolderOpen = withUnistyles(FolderOpen);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const leadingIcon = <ThemedFolderOpen size={14} uniProps={foregroundMutedColorMapping} />;

export function OpenInFileManagerMenuItem({
  path,
  serverId,
  workspaceId,
  testID,
  surface = "dropdown",
  label,
}: OpenInFileManagerMenuItemProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isElectron = getIsElectron();
  const workspacePath = path?.trim() ?? "";
  const workspaceDirectory =
    useWorkspaceFields(
      serverId ?? null,
      workspaceId ?? null,
      (workspace) => workspace.workspaceDirectory,
    ) ?? "";
  const resolvedPath = resolveWorkspacePath(workspacePath, workspaceDirectory);
  const { targets } = useDesktopOpenTargets({
    isLocalExecution: isElectron && resolvedPath.length > 0,
  });
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager");

  const openInFileManager = useCallback(() => {
    if (!fileManagerTarget || resolvedPath.length === 0) return;
    void openDesktopTarget({
      editorId: fileManagerTarget.id,
      workspacePath: resolvedPath,
    }).catch((error) => {
      console.warn("[open-in-file-manager] open failed", error);
      toast.error(t("sidebar.project.actions.openFolderFailed"));
    });
  }, [fileManagerTarget, resolvedPath, t, toast]);

  if (!isElectron || !fileManagerTarget || resolvedPath.length === 0) {
    return null;
  }

  const resolvedLabel = label ?? t("sidebar.project.actions.openFolder");
  if (surface === "context") {
    return (
      <ContextMenuItem testID={testID} leading={leadingIcon} onSelect={openInFileManager}>
        {resolvedLabel}
      </ContextMenuItem>
    );
  }
  return (
    <DropdownMenuItem testID={testID} leading={leadingIcon} onSelect={openInFileManager}>
      {resolvedLabel}
    </DropdownMenuItem>
  );
}
