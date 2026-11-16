import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRight, Check, FolderInput, FolderOpen, Search } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { closeMoveWorkspaceToFolder } from "@/screens/workspace/move-workspace-to-folder-store";
import { useMoveWorkspaceToFolder } from "@/screens/workspace/use-move-workspace-to-folder";
import type { WorkspaceFolderRowModel } from "@/screens/workspace/move-workspace-to-folder-options";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedCheck = withUnistyles(Check);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedSearch = withUnistyles(Search);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

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
          {row.project ? `${row.project} · ${row.directory}` : row.directory}
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
        <View style={styles.emptyState}>
          <ThemedSearch size={ICON_SIZE.md} uniProps={mutedMapping} />
          <Text style={styles.empty}>
            {normalizedQuery
              ? t("workspace.tabs.menu.moveWorkspace.noMatches")
              : t("workspace.tabs.menu.moveWorkspace.empty")}
          </Text>
        </View>
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
    <AdaptiveModalSheet
      header={view.header}
      visible={view.visible}
      onClose={closeMoveWorkspaceToFolder}
      testID="move-workspace-to-folder-sheet"
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
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  loadingRow: {
    alignItems: "center",
    paddingVertical: theme.spacing[2],
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
