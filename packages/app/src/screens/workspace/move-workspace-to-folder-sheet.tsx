import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRight, Check, FolderInput, FolderOpen } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { getDesktopHost } from "@/desktop/host";
import { pickDirectory } from "@/desktop/pick-directory";
import { useSessionStore } from "@/stores/session-store";
import {
  closeMoveWorkspaceToFolder,
  useMoveWorkspaceToFolderRequest,
} from "@/screens/workspace/move-workspace-to-folder-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedCheck = withUnistyles(Check);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

interface WorkspaceFolderRowModel {
  directory: string;
  name: string;
  project: string;
  isCurrent: boolean;
}

function folderName(directory: string): string {
  const segments = directory.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? directory;
}

function WorkspaceFolderRow({
  row,
  disabled,
  moving,
  onSelect,
}: {
  row: WorkspaceFolderRowModel;
  disabled: boolean;
  moving: boolean;
  onSelect: (directory: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(row.directory), [onSelect, row.directory]);
  const rowStyle = useMemo(() => [styles.row, disabled && styles.rowDisabled], [disabled]);
  let trailing;
  if (moving) {
    trailing = <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />;
  } else if (row.isCurrent) {
    trailing = (
      <View style={styles.currentBadge}>
        <ThemedCheck size={ICON_SIZE.sm} uniProps={accentMapping} />
        <Text style={styles.currentLabel}>{t("workspace.tabs.menu.moveWorkspace.current")}</Text>
      </View>
    );
  } else {
    trailing = <ThemedArrowRight size={ICON_SIZE.sm} uniProps={mutedMapping} />;
  }

  return (
    <PressHighlight
      disabled={disabled}
      onPress={handlePress}
      highlightStyle={styles.rowActive}
      style={rowStyle}
      testID={`move-workspace-to-folder-${row.directory}`}
    >
      <ThemedFolderInput size={ICON_SIZE.sm} uniProps={mutedMapping} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {row.project} · {row.directory}
        </Text>
      </View>
      {trailing}
    </PressHighlight>
  );
}

function ChooseAnotherFolderRow({
  disabled,
  moving,
  onSelect,
}: {
  disabled: boolean;
  moving: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const rowStyle = useMemo(() => [styles.row, disabled && styles.rowDisabled], [disabled]);
  return (
    <PressHighlight
      disabled={disabled}
      onPress={onSelect}
      highlightStyle={styles.rowActive}
      style={rowStyle}
      testID="move-workspace-to-folder-pick"
    >
      <ThemedFolderOpen size={ICON_SIZE.sm} uniProps={mutedMapping} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {t("workspace.tabs.menu.moveWorkspace.fallback")}
        </Text>
      </View>
      {moving ? (
        <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />
      ) : (
        <ThemedArrowRight size={ICON_SIZE.sm} uniProps={mutedMapping} />
      )}
    </PressHighlight>
  );
}

/**
 * Re-points a workspace at another folder. The list is the set of folders that
 * are already open as workspaces on this host; the native picker stays as a
 * secondary escape hatch for a folder that is not open yet.
 */
export function MoveWorkspaceToFolderSheet() {
  const { t } = useTranslation();
  const toast = useToast();
  const request = useMoveWorkspaceToFolderRequest();
  const client = useSessionStore((state) =>
    request ? (state.sessions[request.serverId]?.client ?? null) : null,
  );
  const workspaces = useSessionStore((state) =>
    request ? state.sessions[request.serverId]?.workspaces : undefined,
  );
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const current = request && workspaces ? workspaces.get(request.workspaceId) : undefined;
  const canPickDirectory = Boolean(getDesktopHost()?.dialog);
  const visible = Boolean(request && client && current);
  const header = useMemo(() => ({ title: t("workspace.tabs.menu.moveWorkspace.title") }), [t]);

  const rows = useMemo<WorkspaceFolderRowModel[]>(() => {
    const currentDirectory = current?.workspaceDirectory;
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
  }, [current?.workspaceDirectory, workspaces]);

  const relocate = useCallback(
    async (targetPath: string, rowId: string) => {
      if (!client || !current || !request || movingTo) return;
      setMovingTo(rowId);
      try {
        await client.relocateWorkspace(current.id, targetPath);
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
      const target = rows.find((row) => row.directory === directory);
      if (!target || target.isCurrent) return;
      void relocate(target.directory, target.directory);
    },
    [relocate, rows],
  );

  const pickAnotherFolder = useCallback(async () => {
    if (movingTo) return;
    try {
      const path = await pickDirectory();
      if (!path) return;
      await relocate(path, "__picked__");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.tabs.menu.moveWorkspace.failed"),
      );
    }
  }, [movingTo, relocate, t, toast]);
  const handlePickAnother = useCallback(() => {
    void pickAnotherFolder();
  }, [pickAnotherFolder]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={closeMoveWorkspaceToFolder}
      testID="move-workspace-to-folder-sheet"
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {rows.length <= 1 ? (
          <Text style={styles.empty}>{t("workspace.tabs.menu.moveWorkspace.empty")}</Text>
        ) : (
          rows.map((row) => (
            <WorkspaceFolderRow
              key={row.directory}
              row={row}
              disabled={row.isCurrent || movingTo !== null}
              moving={movingTo === row.directory}
              onSelect={selectWorkspace}
            />
          ))
        )}
        {canPickDirectory ? (
          <ChooseAnotherFolderRow
            disabled={movingTo !== null}
            moving={movingTo === "__picked__"}
            onSelect={handlePickAnother}
          />
        ) : null}
      </ScrollView>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flexGrow: 0,
    maxHeight: 420,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[1],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[4],
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 52,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowBody: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
  },
  currentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  currentLabel: {
    color: theme.colors.accentBright,
    fontSize: theme.fontSize["2xs"],
  },
}));
