import { useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQueries, useFetchQuery } from "@/data/query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import {
  aggregateSessionEntries,
  buildProviderLabelMap,
  collectProviderErrorRows,
  type CursorImportEntryData,
  matchesImportEntryQuery,
  mergeImportEntries,
  requiresImportSessionsHostUpgrade,
  resolveProvidersToFetch,
  sumFilteredAlreadyImportedCount,
} from "@/components/import-session-sheet-view-model";

export const PER_PROVIDER_LIMIT = 15;
export const CURSOR_CHAT_LIMIT = 200;
/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

export type ImportSessionClient = Pick<
  DaemonClient,
  "fetchRecentProviderSessions" | "importAgent"
> &
  Partial<Pick<DaemonClient, "listCursorImportChats" | "importCursorChats">>;

interface ImportSessionSourcesInput {
  visible: boolean;
  client: ImportSessionClient | null;
  serverId: string | null;
  /** null lists the whole host instead of one workspace directory. */
  scopeCwd: string | null;
  workspaceId?: string | null;
  searchInput: string;
  pageLimit: number;
  hostDisconnectedMessage: string;
}

type SessionsQueryKey = ReadonlyArray<string | number | null>;

function buildSessionsQueryKey(input: {
  cwd: string | null;
  query: string;
  limit: number;
  provider?: string;
}): SessionsQueryKey {
  return [
    "recent-provider-sessions",
    input.cwd,
    input.query,
    input.limit,
    ...(input.provider === undefined ? [] : [input.provider]),
  ];
}

interface SessionsQueryConfig {
  queryKey: SessionsQueryKey;
  enabled: boolean;
  // A provider that cannot answer stays broken until the user asks again. React
  // Query's default retry would keep the header spinner turning and pile up
  // in-flight daemon requests behind a dead provider (#2512).
  retry: false;
  dataShape: "list";
  staleTimeMs: number;
  queryFn: () => Promise<Awaited<ReturnType<ImportSessionClient["fetchRecentProviderSessions"]>>>;
}

function buildSessionsQueriesConfig(args: {
  providersToFetch: string[] | null;
  visible: boolean;
  client: ImportSessionClient | null;
  cwd: string | null;
  query: string;
  limit: number;
  hostDisconnectedMessage: string;
}): SessionsQueryConfig[] {
  const { providersToFetch, visible, client, cwd, query, limit, hostDisconnectedMessage } = args;
  if (providersToFetch === null) return [];
  const enabled = visible && Boolean(client);
  return providersToFetch.map((provider) => ({
    queryKey: buildSessionsQueryKey({ cwd, query, limit, provider }),
    enabled,
    retry: false as const,
    dataShape: "list" as const,
    staleTimeMs: 0,
    queryFn: async () => {
      if (!client) {
        throw new Error(hostDisconnectedMessage);
      }
      return await client.fetchRecentProviderSessions({
        ...(cwd ? { cwd } : {}),
        providers: [provider],
        limit,
        ...(query ? { query } : {}),
      });
    },
  }));
}

export function useImportSessionSources(input: ImportSessionSourcesInput) {
  const { visible, client, serverId, scopeCwd, workspaceId, searchInput, pageLimit } = input;
  const supportsSearch = useHostFeature(serverId, "importSessionSearch");
  const supportsCursorImport = useHostFeature(serverId, "cursorImport");
  const supportsWorkspaceTarget = useHostFeature(serverId, "importSessionWorkspaceTarget");
  const canListCursorChats =
    supportsCursorImport && typeof client?.listCursorImportChats === "function";
  // Provider sessions need the host search capability; the Cursor listing always
  // supports a text query, so one search field can serve both.
  const showSearch = supportsSearch || canListCursorChats;
  const query = useDebouncedValue(showSearch ? searchInput : "", SEARCH_DEBOUNCE_MS).trim();

  const { entries: snapshotEntries, supportsSnapshot } = useProvidersSnapshot(serverId, {
    cwd: scopeCwd,
    enabled: visible,
  });
  const isSnapshotUnsupported = requiresImportSessionsHostUpgrade({
    supportsSnapshot,
    workspaceId,
    supportsWorkspaceTarget,
  });

  const providersToFetch = useMemo(
    () =>
      isSnapshotUnsupported ? null : resolveProvidersToFetch(supportsSnapshot, snapshotEntries),
    [isSnapshotUnsupported, supportsSnapshot, snapshotEntries],
  );

  const providerLabelById = useMemo(
    () => buildProviderLabelMap(snapshotEntries),
    [snapshotEntries],
  );

  const queriesConfig = useMemo(
    () =>
      buildSessionsQueriesConfig({
        providersToFetch,
        visible,
        client,
        cwd: scopeCwd,
        query,
        limit: pageLimit,
        hostDisconnectedMessage: input.hostDisconnectedMessage,
      }),
    [providersToFetch, visible, client, scopeCwd, query, pageLimit, input.hostDisconnectedMessage],
  );

  const queries = useFetchQueries(queriesConfig);

  const cursorQuery = useFetchQuery({
    queryKey: ["cursor-import-chats", scopeCwd, query],
    enabled: visible && canListCursorChats,
    retry: false,
    dataShape: "list",
    staleTimeMs: 0,
    queryFn: async () => {
      if (!client?.listCursorImportChats) {
        throw new Error(input.hostDisconnectedMessage);
      }
      return await client.listCursorImportChats({
        ...(scopeCwd ? { cwd: scopeCwd } : {}),
        ...(query ? { query } : {}),
        limit: CURSOR_CHAT_LIMIT,
      });
    },
  });

  const cursorChats = useMemo<CursorImportEntryData[]>(
    () =>
      (cursorQuery.data?.chats ?? [])
        .filter((chat) => chat.cwd !== null)
        .map((chat) => ({
          composerId: chat.composerId,
          title: chat.title,
          cwd: chat.cwd,
          subtitle: chat.subtitle,
          createdAt: chat.createdAt,
          lastUpdatedAt: chat.lastUpdatedAt,
          model: chat.model,
          isSubagent: chat.isSubagent,
          subagentTypeName: chat.subagentTypeName,
          importedAgentId: chat.importedAgentId,
        })),
    [cursorQuery.data],
  );

  const providerEntries = useMemo(() => aggregateSessionEntries(queries), [queries]);
  const totalAlreadyImportedCount = useMemo(
    () => sumFilteredAlreadyImportedCount(queries),
    [queries],
  );

  // Daemons without provider search cannot narrow provider rows, so the client
  // applies the same text match the daemon would have applied.
  const matchingProviderEntries = useMemo(
    () =>
      supportsSearch
        ? providerEntries
        : providerEntries.filter((entry) =>
            matchesImportEntryQuery({ kind: "provider", entry }, query),
          ),
    [providerEntries, query, supportsSearch],
  );
  const allEntries = useMemo(
    () => mergeImportEntries(matchingProviderEntries, cursorChats),
    [matchingProviderEntries, cursorChats],
  );

  const providerErrorRows = useMemo(
    () => collectProviderErrorRows(providersToFetch, queries, providerLabelById),
    [queries, providersToFetch, providerLabelById],
  );

  // Every query settles, errors included, so this stops turning (#2512).
  const isRefreshing =
    cursorQuery.isFetching || queries.some((providerQuery) => providerQuery.isFetching);
  const isWaitingForSnapshot = supportsSnapshot && snapshotEntries === undefined;

  return {
    showSearch,
    query,
    canListCursorChats,
    supportsSnapshot,
    isWaitingForSnapshot,
    isSnapshotUnsupported,
    providersToFetch,
    providerLabelById,
    queries,
    cursorQuery,
    providerEntries,
    cursorChats,
    allEntries,
    totalAlreadyImportedCount,
    providerErrorRows,
    isRefreshing,
  };
}

export { buildSessionsQueryKey };
