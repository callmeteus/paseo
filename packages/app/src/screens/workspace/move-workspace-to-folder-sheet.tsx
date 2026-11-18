import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, FolderInput, FolderOpen } from "lucide-react-native";
import { CommandPanel, CommandPanelRow } from "@/components/ui/command-panel";
import { ScrollView } from "@/components/ui/scroll-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { closeMoveWorkspaceToFolder } from "@/screens/workspace/move-workspace-to-folder-store";
import { useMoveWorkspaceToFolder } from "@/screens/workspace/use-move-workspace-to-folder";
import type { WorkspaceFolderRowModel } from "@/screens/workspace/move-workspace-to-folder-options";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedCheck = withUnistyles(Check);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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
  let trailing;
  if (moving) {
    trailing = <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />;
  } else if (row.isCurrent) {
    trailing = (
      <View style={styles.currentBadge}>
        <ThemedCheck size={ICON_SIZE.sm} uniProps={mutedMapping} />
        <Text style={styles.currentLabel}>{t("workspace.tabs.menu.moveWorkspace.current")}</Text>
      </View>
    );
  }

  return (
    <CommandPanelRow
      disabled={disabled}
      onPress={handlePress}
      testID={`move-workspace-to-folder-${row.directory}`}
      title={row.name}
      meta={row.project ? `${row.project} · ${row.directory}` : row.directory}
      trailing={trailing}
    >
      <ThemedFolderInput size={ICON_SIZE.sm} uniProps={mutedMapping} />
    </CommandPanelRow>
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
  let trailing;
  if (moving) {
    trailing = <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />;
  }
  return (
    <CommandPanelRow
      disabled={disabled}
      onPress={onSelect}
      testID="move-workspace-to-folder-pick"
      title={t("workspace.tabs.menu.moveWorkspace.fallback")}
      trailing={trailing}
    >
      <ThemedFolderOpen size={ICON_SIZE.sm} uniProps={mutedMapping} />
    </CommandPanelRow>
  );
}

function MoveWorkspaceToFolderList({
  filteredRows,
  suggestionRows,
  showListEmpty,
  normalizedQuery,
  searchPending,
  movingTo,
  canPickDirectory,
  onSelect,
  onPickAnother,
}: {
  filteredRows: WorkspaceFolderRowModel[];
  suggestionRows: WorkspaceFolderRowModel[];
  showListEmpty: boolean;
  normalizedQuery: string;
  searchPending: boolean;
  movingTo: string | null;
  canPickDirectory: boolean;
  onSelect: (directory: string) => void;
  onPickAnother: () => void;
}) {
  const { t } = useTranslation();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {showListEmpty ? (
        <Text style={styles.empty}>
          {normalizedQuery
            ? t("workspace.tabs.menu.moveWorkspace.noMatches")
            : t("workspace.tabs.menu.moveWorkspace.empty")}
        </Text>
      ) : (
        <>
          {filteredRows.map((row) => (
            <WorkspaceFolderRow
              key={row.directory}
              row={row}
              disabled={row.isCurrent || movingTo !== null}
              moving={movingTo === row.directory}
              onSelect={onSelect}
            />
          ))}
          {suggestionRows.map((row) => (
            <WorkspaceFolderRow
              key={`suggestion:${row.directory}`}
              row={row}
              disabled={movingTo !== null}
              moving={movingTo === row.directory}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
      {searchPending ? (
        <View style={styles.loadingRow}>
          <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />
        </View>
      ) : null}
      {canPickDirectory ? (
        <ChooseAnotherFolderRow
          disabled={movingTo !== null}
          moving={movingTo === "__picked__"}
          onSelect={onPickAnother}
        />
      ) : null}
    </ScrollView>
  );
}

/**
 * Re-points a workspace at another folder. Open workspaces on the host are listed
 * first; search asks the daemon for directories on that host. The native picker is
 * only for the local daemon — remote hosts never open folders on the client machine.
 */
export function MoveWorkspaceToFolderSheet() {
  const view = useMoveWorkspaceToFolder();

  return (
    <CommandPanel
      title={view.header.title}
      visible={view.visible}
      onClose={closeMoveWorkspaceToFolder}
      testID="move-workspace-to-folder-sheet"
      search={view.header.search}
    >
      <MoveWorkspaceToFolderList
        filteredRows={view.filteredRows}
        suggestionRows={view.suggestionRows}
        showListEmpty={view.showListEmpty}
        normalizedQuery={view.normalizedQuery}
        searchPending={view.searchPending}
        movingTo={view.movingTo}
        canPickDirectory={view.canPickDirectory}
        onSelect={view.selectWorkspace}
        onPickAnother={view.pickAnotherFolder}
      />
    </CommandPanel>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flexGrow: 0,
    maxHeight: 420,
  },
  content: {
    paddingBottom: theme.spacing[2],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  loadingRow: {
    alignItems: "center",
    paddingVertical: theme.spacing[2],
  },
  currentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  currentLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
