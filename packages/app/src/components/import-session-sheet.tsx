import React, { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Inbox, Layers, RotateCw } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { ImportSessionList } from "@/components/import-session-list";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { useProviderIcon, useProviderIcons } from "@/components/provider-icons";
import {
  buildSessionsQueryKey,
  useImportSessionSources,
  type ImportSessionClient,
} from "@/components/use-import-session-sources";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { useHostProjects } from "@/projects/host-projects";
import { useHosts } from "@/runtime/host-runtime";
import {
  ALL_FILTER_VALUE,
  CURSOR_PROVIDER_ID,
  type DirectoryProject,
  filterImportEntriesByProvider,
  formatDirectoryLabel,
  getImportEntryCwd,
  getImportEntryKey,
  getImportEntryPreview,
  getImportEntryProviderId,
  getImportEntryTitle,
  hasMoreSessions,
  type ImportSessionEntry,
  isImportEntryAlreadyImported,
  resolveDirectoryLabel,
  nextPageLimit,
  PER_PROVIDER_LIMIT,
  type ProviderErrorRow,
  resolveImportSheetStatus,
  resolveImportTarget,
} from "@/components/import-session-sheet-view-model";

const IMPORT_SHEET_SNAP_POINTS = ["70%", "92%"];
const DISABLED_ACCESSIBILITY_STATE = { disabled: true };

interface ImportedAgentTarget {
  id: string;
  cwd: string;
}

interface ImportSessionSheetProps {
  visible: boolean;
  client: ImportSessionClient | null;
  serverId: string | null;
  cwd?: string | null;
  workspaceId?: string | null;
  onClose: () => void;
  /** The agent belongs to the workspace the sheet was opened from; open it here. */
  onImportedAgent?: (agentId: string) => void;
  /** The agent belongs to its own workspace; open that workspace and navigate. */
  onImported?: (agent: ImportedAgentTarget) => void;
}

interface SheetStatusMessagesProps {
  isClientReady: boolean;
  isSnapshotUnsupported: boolean;
  hasNoImportableProviders: boolean;
  isLoadingSessions: boolean;
  hasRows: boolean;
  importErrored: boolean;
}

function SheetStatusMessages({
  isClientReady,
  isSnapshotUnsupported,
  hasNoImportableProviders,
  isLoadingSessions,
  hasRows,
  importErrored,
}: SheetStatusMessagesProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (!isClientReady) {
    return <Text style={styles.statusText}>{t("importSession.status.connectHost")}</Text>;
  }
  if (isSnapshotUnsupported) {
    return <Text style={styles.statusText}>{t("importSession.status.updateHost")}</Text>;
  }
  return (
    <>
      {hasNoImportableProviders ? (
        <Text style={styles.statusText}>{t("importSession.status.noProviders")}</Text>
      ) : null}
      {isLoadingSessions && !hasRows ? (
        <View style={styles.statusRow}>
          <LoadingSpinner color={theme.colors.foregroundMuted} />
          <Text style={styles.statusText}>{t("importSession.status.loading")}</Text>
        </View>
      ) : null}
      {importErrored ? (
        <Text style={styles.statusText}>{t("importSession.status.failedImport")}</Text>
      ) : null}
    </>
  );
}

function ProviderErrorBanner({
  rows,
  onRetry,
}: {
  rows: ReadonlyArray<ProviderErrorRow>;
  onRetry: (provider: string) => void;
}) {
  return (
    <View style={styles.errorBanner} testID="import-session-provider-errors">
      {rows.map((row) => (
        <ProviderErrorBannerRow key={row.provider} row={row} onRetry={onRetry} />
      ))}
    </View>
  );
}

function ProviderErrorBannerRow({
  row,
  onRetry,
}: {
  row: ProviderErrorRow;
  onRetry: (provider: string) => void;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => onRetry(row.provider), [onRetry, row.provider]);
  return (
    <View style={styles.errorRow}>
      <Text style={styles.errorText}>
        {t("importSession.status.failedProvider", { provider: row.label })}
      </Text>
      <Button
        variant="ghost"
        size="xs"
        onPress={handleRetry}
        testID={`import-session-retry-${row.provider}`}
      >
        {t("common.actions.retry")}
      </Button>
    </View>
  );
}

function RefreshAction({ isRefreshing, onPress }: { isRefreshing: boolean; onPress: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.refreshButton,
      pressed && styles.refreshButtonPressed,
    ],
    [],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={isRefreshing}
      accessibilityLabel={t("importSession.actions.refresh")}
      accessibilityRole="button"
      testID="import-session-refresh"
      style={pressableStyle}
    >
      <View style={styles.refreshIconSlot}>
        {isRefreshing ? (
          <LoadingSpinner color={theme.colors.foregroundMuted} />
        ) : (
          <RotateCw size={16} color={theme.colors.foregroundMuted} />
        )}
      </View>
    </Pressable>
  );
}

function ScopeSubtitle({
  hostLabel,
  isScoped,
  onShowAll,
}: {
  hostLabel: string;
  isScoped: boolean;
  onShowAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.subtitleRow}>
      <Text style={styles.subtitleText} numberOfLines={1} testID="import-session-scope">
        {isScoped
          ? t("importSession.scope.workspace")
          : t("importSession.scope.host", { host: hostLabel })}
      </Text>
      {isScoped ? (
        <Button
          variant="ghost"
          size="xs"
          onPress={onShowAll}
          testID="import-session-show-all"
          style={styles.subtitleAction}
        >
          {t("importSession.actions.showAll")}
        </Button>
      ) : null}
    </View>
  );
}

function SheetEmptyState({ title }: { title: string }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.emptyState} testID="import-session-empty-state">
      <View style={styles.emptyStateIcon}>
        <Inbox size={theme.iconSize.lg} color={theme.colors.foregroundMuted} strokeWidth={1.5} />
      </View>
      <Text style={styles.emptyStateTitle}>{title}</Text>
    </View>
  );
}

function ImportSessionSheetRow({
  serverId,
  row,
  disabled,
  importing,
  folder,
  onImportSession,
}: {
  serverId: string | null;
  row: ImportSessionEntry;
  disabled: boolean;
  importing: boolean;
  /** The row's directory, shown only when rows can come from more than one. */
  folder: string | null;
  onImportSession: (row: ImportSessionEntry) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const title = getImportEntryTitle(row);
  const promptPreview = getImportEntryPreview(row);
  const providerId = getImportEntryProviderId(row);
  const ProviderIcon = useProviderIcon(providerId, serverId);
  const alreadyImported = isImportEntryAlreadyImported(row);
  const isDisabled = disabled || alreadyImported;
  const lastActivityAt =
    row.kind === "provider" ? row.entry.lastActivityAt : row.chat.lastUpdatedAt;
  const accessibilityState = useMemo(
    () => (isDisabled ? DISABLED_ACCESSIBILITY_STATE : undefined),
    [isDisabled],
  );
  const handlePress = useCallback(() => {
    onImportSession(row);
  }, [onImportSession, row]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );

  return (
    <Pressable
      disabled={isDisabled}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={pressableStyle}
      testID={
        row.kind === "provider"
          ? `import-session-session-${row.entry.providerId}-${row.entry.providerHandleId}`
          : `import-session-cursor-${row.chat.composerId}`
      }
    >
      <View style={styles.rowIconWrap}>
        <ProviderIcon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {importing ? (
            <Text style={styles.rowMeta}>{t("importSession.row.importing")}</Text>
          ) : (
            <ImportSessionActivityTime date={lastActivityAt} />
          )}
        </View>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {promptPreview}
        </Text>
        {alreadyImported ? (
          <Text style={styles.rowImportedBadge}>{t("cursorImport.alreadyImported")}</Text>
        ) : null}
        {folder ? (
          <Text
            style={styles.rowFolder}
            numberOfLines={1}
            testID={
              row.kind === "provider"
                ? `import-session-row-folder-${row.entry.providerId}-${row.entry.providerHandleId}`
                : `import-session-row-folder-cursor-${row.chat.composerId}`
            }
          >
            {folder}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ImportSessionActivityTime({ date }: { date: string }) {
  const label = useTimeAgo(new Date(date));
  return <Text style={styles.rowMeta}>{label}</Text>;
}

function SessionRows({
  visible,
  onClose,
  header,
  listHeader,
  listFooter,
  serverId,
  entries,
  disabled,
  importingSessionKey,
  resolveFolder,
  onImportSession,
}: {
  visible: boolean;
  onClose: () => void;
  header: SheetHeader;
  listHeader: ReactNode;
  listFooter: ReactNode;
  serverId: string | null;
  entries: ReadonlyArray<ImportSessionEntry>;
  disabled: boolean;
  importingSessionKey: string | null;
  resolveFolder: (entry: ImportSessionEntry) => string | null;
  onImportSession: (entry: ImportSessionEntry) => void;
}) {
  // Keep short results content-sized; only long lists need a bounded viewport.
  const virtualized = ImportSessionList !== null && entries.length > 8;
  const renderSessionRow = useCallback(
    (entry: ImportSessionEntry) => (
      <ImportSessionSheetRow
        key={getImportEntryKey(entry)}
        serverId={serverId}
        row={entry}
        disabled={disabled}
        importing={importingSessionKey === getImportEntryKey(entry)}
        folder={resolveFolder(entry)}
        onImportSession={onImportSession}
      />
    ),
    [serverId, disabled, importingSessionKey, resolveFolder, onImportSession],
  );
  const renderItem = useCallback(
    (item: ImportSessionEntry) => <View style={styles.listRow}>{renderSessionRow(item)}</View>,
    [renderSessionRow],
  );
  const virtualHeader = useMemo(
    () => (listHeader ? <View style={styles.listHeader}>{listHeader}</View> : null),
    [listHeader],
  );
  const virtualFooter = useMemo(
    () => <View style={styles.listFooter}>{listFooter}</View>,
    [listFooter],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="import-session-sheet"
      desktopMaxWidth={560}
      desktopHeight={virtualized ? "85%" : undefined}
      snapPoints={IMPORT_SHEET_SNAP_POINTS}
      scrollable={!virtualized}
      contentStyle={virtualized ? styles.listBody : undefined}
    >
      {ImportSessionList && virtualized ? (
        <View style={styles.list}>
          <ImportSessionList
            data={entries}
            keyExtractor={getImportEntryKey}
            renderItem={renderItem}
            header={virtualHeader}
            footer={virtualFooter}
          />
        </View>
      ) : (
        <>
          {listHeader}
          {entries.length > 0 ? (
            <View style={styles.smallList}>{entries.map(renderSessionRow)}</View>
          ) : null}
          {listFooter}
        </>
      )}
    </AdaptiveModalSheet>
  );
}

export function ImportSessionSheet({
  visible,
  client,
  serverId,
  cwd,
  workspaceId,
  onClose,
  onImportedAgent,
  onImported,
}: ImportSessionSheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { theme } = useUnistyles();
  const toast = useToast();

  // "Show all" widens a workspace-scoped sheet to the whole host. The sheet's own
  // `cwd` stays the scope it was opened with, because that is what decides where
  // an imported agent lands.
  const [isShowingAllDirectories, setIsShowingAllDirectories] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [pageLimit, setPageLimit] = useState(PER_PROVIDER_LIMIT);
  const [selectedProvider, setSelectedProvider] = useState<string>(ALL_FILTER_VALUE);

  const scopeCwd = isShowingAllDirectories ? null : (cwd ?? null);

  useEffect(() => {
    if (visible) return;
    setIsShowingAllDirectories(false);
    setSearchInput("");
  }, [visible]);

  const {
    showSearch,
    query,
    canListCursorChats,
    isWaitingForSnapshot,
    isSnapshotUnsupported: requiresHostUpgrade,
    providersToFetch,
    providerLabelById,
    queries,
    cursorQuery,
    cursorChats,
    allEntries,
    totalAlreadyImportedCount,
    providerErrorRows,
    isRefreshing,
  } = useImportSessionSources({
    visible,
    client,
    serverId,
    scopeCwd,
    workspaceId,
    searchInput,
    pageLimit,
    hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
  });

  // A narrower or wider list starts at page one; keeping a grown limit would
  // fetch 200 rows for a query that matches three.
  useEffect(() => {
    setPageLimit(PER_PROVIDER_LIMIT);
  }, [query, scopeCwd]);

  const sessionsQueryRoot = useMemo(() => ["recent-provider-sessions", scopeCwd], [scopeCwd]);

  const filterProviders = useMemo(() => {
    const providers = new Set(providersToFetch ?? []);
    if (cursorChats.length > 0) providers.add(CURSOR_PROVIDER_ID);
    return [...providers].sort();
  }, [providersToFetch, cursorChats.length]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterAnchorRef = useRef<View>(null);

  useEffect(() => {
    if (
      !visible ||
      (selectedProvider !== ALL_FILTER_VALUE && !filterProviders.includes(selectedProvider))
    ) {
      setSelectedProvider(ALL_FILTER_VALUE);
    }
  }, [visible, filterProviders, selectedProvider]);

  const visibleEntries = useMemo(
    () => filterImportEntriesByProvider(allEntries, selectedProvider),
    [allEntries, selectedProvider],
  );

  const projectServerIds = useMemo(() => (serverId ? [serverId] : []), [serverId]);
  const hostProjects = useHostProjects(projectServerIds);
  const directoryProjects = useMemo<DirectoryProject[]>(
    () =>
      hostProjects.map((project) => ({
        rootPath: project.iconWorkingDir,
        name: project.projectName,
      })),
    [hostProjects],
  );

  // A scoped sheet only lists one directory, so naming it on every row is noise.
  const showRowFolders = scopeCwd === null;
  const resolveFolder = useCallback(
    (entry: ImportSessionEntry) => {
      const entryCwd = getImportEntryCwd(entry);
      return showRowFolders && entryCwd
        ? formatDirectoryLabel(resolveDirectoryLabel(entryCwd, directoryProjects))
        : null;
    },
    [showRowFolders, directoryProjects],
  );

  const filterComboboxOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: ALL_FILTER_VALUE, label: t("importSession.filters.all") },
      ...filterProviders.map((provider) => ({
        id: provider,
        label:
          providerLabelById.get(provider) ??
          (provider === CURSOR_PROVIDER_ID ? "Cursor" : provider),
      })),
    ],
    [filterProviders, providerLabelById, t],
  );

  const selectedProviderLabel = useMemo(
    () =>
      filterComboboxOptions.find((opt) => opt.id === selectedProvider)?.label ??
      t("importSession.filters.all"),
    [filterComboboxOptions, selectedProvider, t],
  );

  const handleFilterOpen = useCallback(() => setIsFilterOpen(true), []);

  const filterTriggerStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterTrigger,
      Boolean(hovered) && styles.filterTriggerHovered,
      pressed && styles.filterTriggerPressed,
    ],
    [],
  );

  const handleFilterSelect = useCallback((id: string) => {
    setSelectedProvider(id);
    setIsFilterOpen(false);
  }, []);

  const getProviderIcon = useProviderIcons(serverId);
  const SelectedProviderIcon = useProviderIcon(selectedProvider, serverId);
  const filterOptionIcons = useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    map.set(ALL_FILTER_VALUE, <Layers size={14} color={theme.colors.foregroundMuted} />);
    for (const provider of filterProviders) {
      const ProviderIcon = getProviderIcon(provider);
      map.set(provider, <ProviderIcon size={14} color={theme.colors.foregroundMuted} />);
    }
    return map;
  }, [filterProviders, getProviderIcon, theme.colors.foregroundMuted]);

  const renderFilterOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={filterOptionIcons.get(option.id)}
      />
    ),
    [filterOptionIcons],
  );

  const importMutation = useMutation({
    mutationFn: async (row: ImportSessionEntry) => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      if (row.kind === "cursor") {
        if (!client.importCursorChats) {
          throw new Error(t("cursorImport.importFailed"));
        }
        const result = await client.importCursorChats({
          composerIds: [row.chat.composerId],
          includeSubagents: true,
        });
        if (result.error) {
          throw new Error(result.error);
        }
        const imported =
          result.chats.find(
            (chat) =>
              chat.composerId === row.chat.composerId &&
              chat.status === "imported" &&
              chat.agentId &&
              chat.cwd,
          ) ?? result.chats.find((chat) => chat.status === "imported" && chat.agentId && chat.cwd);
        if (!imported?.agentId || !imported.cwd) {
          throw new Error(t("cursorImport.importFailed"));
        }
        return {
          kind: "cursor" as const,
          result,
          target: { id: imported.agentId, cwd: imported.cwd },
        };
      }
      const entry = row.entry;
      if (!entry.cwd) {
        throw new Error("Session is missing a working directory");
      }
      const target = resolveImportTarget({
        entryCwd: entry.cwd,
        workspaceCwd: cwd,
        workspaceId,
        isScopedListing: scopeCwd !== null,
      });
      const agent = await client.importAgent({
        providerId: entry.providerId,
        providerHandleId: entry.providerHandleId,
        cwd: entry.cwd,
        ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
      });
      return { kind: "provider" as const, agent, target };
    },
    onSuccess: (outcome) => {
      onClose();
      if (outcome.kind === "cursor") {
        toast.show(t("cursorImport.imported", { count: outcome.result.importedCount }), {
          variant: "success",
        });
        onImported?.(outcome.target);
        void queryClient.invalidateQueries({ queryKey: ["cursor-import-chats"] });
        return;
      }
      if (outcome.target.crossWorkspace) {
        onImported?.(outcome.agent);
      } else {
        onImportedAgent?.(outcome.agent.id);
      }
      void queryClient.invalidateQueries({
        queryKey: sessionsQueryRoot,
        refetchType: "none",
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("cursorImport.importFailed"));
    },
  });

  const importingSessionKey =
    importMutation.isPending && importMutation.variables
      ? getImportEntryKey(importMutation.variables)
      : null;

  const handleImportSession = useCallback(
    (entry: ImportSessionEntry) => {
      importMutation.mutate(entry);
    },
    [importMutation],
  );

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
    void queryClient.invalidateQueries({ queryKey: ["cursor-import-chats"] });
  }, [queryClient, sessionsQueryRoot]);

  const handleRetryProvider = useCallback(
    (provider: string) => {
      void queryClient.refetchQueries({
        queryKey: buildSessionsQueryKey({ cwd: scopeCwd, query, limit: pageLimit, provider }),
      });
    },
    [pageLimit, query, queryClient, scopeCwd],
  );

  const handleShowAll = useCallback(() => setIsShowingAllDirectories(true), []);
  const handleLoadMore = useCallback(() => setPageLimit(nextPageLimit), []);

  const hosts = useHosts();
  const hostLabel = useMemo(
    () => hosts.find((host) => host.serverId === serverId)?.label ?? serverId ?? "",
    [hosts, serverId],
  );

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("importSession.title"),
      subtitle: (
        <ScopeSubtitle
          hostLabel={hostLabel}
          isScoped={scopeCwd !== null}
          onShowAll={handleShowAll}
        />
      ),
      ...(showSearch
        ? {
            search: {
              onChange: setSearchInput,
              placeholder: t("importSession.searchPlaceholder"),
              // The compact sheet keeps its content mounted while hidden, so the
              // field has to be told to drop the text the state already dropped.
              resetKey: visible ? "open" : "closed",
              testID: "import-session-search",
            },
          }
        : {}),
      actions: <RefreshAction isRefreshing={isRefreshing} onPress={handleRefresh} />,
    }),
    [handleRefresh, handleShowAll, hostLabel, isRefreshing, scopeCwd, showSearch, t, visible],
  );

  const showFilter = filterProviders.length > 1;
  const filterLabelById = useMemo(
    () =>
      new Map(providerLabelById).set(
        CURSOR_PROVIDER_ID,
        providerLabelById.get(CURSOR_PROVIDER_ID) ?? "Cursor",
      ),
    [providerLabelById],
  );
  const status = resolveImportSheetStatus({
    isClientReady: Boolean(client),
    isWaitingForSnapshot,
    isSnapshotUnsupported: requiresHostUpgrade,
    providersToFetchCount: providersToFetch === null ? null : providersToFetch.length,
    providerQueries: queries,
    cursorEnabled: canListCursorChats,
    cursorLoading: cursorQuery.isLoading,
    cursorErrored: cursorQuery.isError,
    cursorUnavailable: cursorQuery.data?.sourceAvailable === false,
    showFilter,
    hasProviderErrors: providerErrorRows.length > 0,
    importErrored: importMutation.isError,
    visibleCount: visibleEntries.length,
    selectedProvider,
    hasQuery: query.length > 0,
    aggregatedCount: allEntries.length,
    totalAlreadyImportedCount,
    providerLabelById: filterLabelById,
  });
  const { showEmptyState, emptyStateTitle, showListHeader } = status;
  const { isCursorErrored, showCursorUnavailable, hasNoImportableProviders, isLoadingSessions } =
    status;
  const isSnapshotUnsupported = requiresHostUpgrade;
  const showLoadMore = hasMoreSessions(queries, pageLimit);
  const listHeader = useMemo(
    () =>
      showListHeader ? (
        <View style={styles.listHeaderContent}>
          {showFilter ? (
            <View ref={filterAnchorRef} collapsable={false} style={styles.filterTriggerWrap}>
              <Pressable
                onPress={handleFilterOpen}
                style={filterTriggerStyle}
                testID="import-session-filter-trigger"
                accessibilityRole="button"
                accessibilityLabel={`Filter: ${selectedProviderLabel}`}
              >
                {selectedProvider === ALL_FILTER_VALUE ? (
                  <Layers size={14} color={theme.colors.foregroundMuted} />
                ) : (
                  <SelectedProviderIcon size={14} color={theme.colors.foregroundMuted} />
                )}
                <Text style={styles.filterTriggerText} numberOfLines={1}>
                  {selectedProviderLabel}
                </Text>
                <ChevronDown size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
              <Combobox
                options={filterComboboxOptions}
                value={selectedProvider}
                onSelect={handleFilterSelect}
                renderOption={renderFilterOption}
                searchable={false}
                title="Filter by provider"
                open={isFilterOpen}
                onOpenChange={setIsFilterOpen}
                anchorRef={filterAnchorRef}
                desktopPlacement="bottom-start"
                desktopPreventInitialFlash
              />
            </View>
          ) : null}
          <SheetStatusMessages
            isClientReady={Boolean(client)}
            isSnapshotUnsupported={isSnapshotUnsupported}
            hasNoImportableProviders={hasNoImportableProviders}
            isLoadingSessions={isLoadingSessions}
            hasRows={visibleEntries.length > 0}
            importErrored={importMutation.isError}
          />
          {isCursorErrored ? (
            <Text style={styles.statusText}>{t("cursorImport.loadFailed")}</Text>
          ) : null}
          {showCursorUnavailable ? (
            <Text style={styles.statusText}>{t("cursorImport.unavailable")}</Text>
          ) : null}
          {providerErrorRows.length > 0 ? (
            <ProviderErrorBanner rows={providerErrorRows} onRetry={handleRetryProvider} />
          ) : null}
        </View>
      ) : null,
    [
      showListHeader,
      showFilter,
      filterTriggerStyle,
      handleFilterOpen,
      selectedProvider,
      theme.colors.foregroundMuted,
      SelectedProviderIcon,
      selectedProviderLabel,
      filterComboboxOptions,
      handleFilterSelect,
      renderFilterOption,
      isFilterOpen,
      client,
      isSnapshotUnsupported,
      hasNoImportableProviders,
      isLoadingSessions,
      visibleEntries.length,
      importMutation.isError,
      isCursorErrored,
      showCursorUnavailable,
      t,
      providerErrorRows,
      handleRetryProvider,
    ],
  );
  const listFooter = useMemo(
    () => (
      <>
        {showLoadMore ? (
          <View style={styles.footer}>
            <Button
              variant="ghost"
              onPress={handleLoadMore}
              disabled={isRefreshing}
              testID="import-session-load-more"
            >
              {t("importSession.actions.loadMore")}
            </Button>
          </View>
        ) : null}
        {showEmptyState ? <SheetEmptyState title={emptyStateTitle} /> : null}
      </>
    ),
    [showLoadMore, handleLoadMore, isRefreshing, t, showEmptyState, emptyStateTitle],
  );

  return (
    <SessionRows
      visible={visible}
      onClose={onClose}
      header={header}
      listHeader={listHeader}
      listFooter={listFooter}
      serverId={serverId}
      entries={visibleEntries}
      disabled={importMutation.isPending}
      importingSessionKey={importingSessionKey}
      resolveFolder={resolveFolder}
      onImportSession={handleImportSession}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  subtitleText: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  subtitleAction: {
    marginHorizontal: -theme.spacing[2],
  },
  filterTriggerWrap: {
    paddingBottom: theme.spacing[2],
  },
  filterTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  filterTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  filterTriggerPressed: {
    backgroundColor: theme.colors.surface3,
  },
  filterTriggerText: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  listBody: {
    gap: 0,
  },
  list: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: -theme.spacing[2],
  },
  listHeader: {
    marginHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  listHeaderContent: {
    gap: theme.spacing[4],
  },
  smallList: {
    gap: theme.spacing[1],
  },
  listFooter: {
    marginHorizontal: theme.spacing[2],
  },
  listRow: {
    marginHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  footer: {
    paddingTop: theme.spacing[2],
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    marginHorizontal: -theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowIconWrap: {
    width: theme.iconSize.md,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  rowFolder: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowImportedBadge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorBanner: {
    marginBottom: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  errorText: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  emptyStateIcon: {
    opacity: 0.6,
    marginBottom: theme.spacing[1],
  },
  emptyStateTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  refreshButton: {
    padding: theme.spacing[2],
    marginRight: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
  },
  refreshButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  refreshIconSlot: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
}));
