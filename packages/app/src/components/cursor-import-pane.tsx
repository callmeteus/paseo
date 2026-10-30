import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useTimeAgo } from "@/hooks/use-time-ago";

export type CursorImportClient = Pick<DaemonClient, "listCursorImportChats" | "importCursorChats">;

type CursorChatRow = Awaited<
  ReturnType<CursorImportClient["listCursorImportChats"]>
>["chats"][number];

export interface CursorImportTarget {
  id: string;
  cwd: string;
}

interface CursorImportPaneProps {
  client: CursorImportClient | null;
  /** Debounced search text owned by the sheet header. */
  query: string;
  onImported: (target: CursorImportTarget) => void;
}

const ThemedCheck = withUnistyles(Check, (theme) => ({ color: theme.colors.foreground }));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function basename(cwd: string | null): string | null {
  if (!cwd) return null;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? null;
}

function CursorRow({
  chat,
  selected,
  onToggle,
}: {
  chat: CursorChatRow;
  selected: boolean;
  onToggle: (composerId: string) => void;
}) {
  const { t } = useTranslation();
  const updated = useTimeAgo(new Date(chat.lastUpdatedAt));
  const project = basename(chat.cwd);
  const disabled = chat.importedAgentId !== null;

  const handlePress = useCallback(() => {
    if (!disabled) onToggle(chat.composerId);
  }, [chat.composerId, disabled, onToggle]);

  const accessibilityState = useMemo(() => ({ checked: selected, disabled }), [disabled, selected]);

  const meta = [
    project,
    chat.model,
    chat.isSubagent ? (chat.subagentTypeName ?? t("cursorImport.subagent")) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PressHighlight
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      testID={`cursor-import-row-${chat.composerId}`}
      style={styles.row}
      highlightStyle={styles.rowHighlight}
    >
      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
        {selected ? <ThemedCheck size={14} strokeWidth={3} /> : null}
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {chat.title ?? t("cursorImport.untitled")}
          </Text>
          <Text style={styles.rowMeta}>{updated}</Text>
        </View>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {meta}
        </Text>
        {chat.importedAgentId ? (
          <Text style={styles.importedBadge}>{t("cursorImport.alreadyImported")}</Text>
        ) : null}
      </View>
    </PressHighlight>
  );
}

export function CursorImportPane({ client, query, onImported }: CursorImportPaneProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const listing = useFetchQuery({
    dataShape: "list",
    queryKey: ["cursor-import-chats", query],
    enabled: Boolean(client),
    retry: false,
    staleTimeMs: 0,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return await client.listCursorImportChats({
        ...(query ? { query } : {}),
        limit: 200,
      });
    },
  });

  const chats = useMemo(
    () => (listing.data?.chats ?? []).filter((chat) => chat.cwd !== null),
    [listing.data],
  );
  const selectable = useMemo(() => chats.filter((chat) => chat.importedAgentId === null), [chats]);

  const importMutation = useMutation({
    mutationFn: async (composerIds: string[]) => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const result = await client.importCursorChats({ composerIds, includeSubagents: true });
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      const firstImported = result.chats.find(
        (chat) => chat.status === "imported" && chat.agentId && chat.cwd,
      );
      toast.show(t("cursorImport.imported", { count: result.importedCount }), {
        variant: "success",
      });
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["cursor-import-chats"] });
      if (firstImported?.agentId && firstImported.cwd) {
        onImported({ id: firstImported.agentId, cwd: firstImported.cwd });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("cursorImport.importFailed"));
    },
  });

  const toggle = useCallback((composerId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(composerId)) next.delete(composerId);
      else next.add(composerId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      if (current.size > 0) return new Set();
      return new Set(selectable.map((chat) => chat.composerId));
    });
  }, [selectable]);

  const handleImportSelected = useCallback(() => {
    importMutation.mutate([...selected]);
  }, [importMutation, selected]);

  const renderRow = useCallback(
    (chat: CursorChatRow) => (
      <CursorRow
        key={chat.composerId}
        chat={chat}
        selected={selected.has(chat.composerId)}
        onToggle={toggle}
      />
    ),
    [selected, toggle],
  );

  const isUnavailable = listing.data?.sourceAvailable === false;
  const isSelectAll = selected.size > 0;

  const renderBody = () => {
    if (listing.isPending) {
      return (
        <View style={styles.center}>
          <ThemedSpinner size="small" />
        </View>
      );
    }
    if (isUnavailable) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t("cursorImport.unavailable")}</Text>
        </View>
      );
    }
    if (listing.isError) {
      const message =
        listing.error instanceof Error ? listing.error.message : t("cursorImport.loadFailed");
      return (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{message}</Text>
        </View>
      );
    }
    if (chats.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t("cursorImport.empty")}</Text>
        </View>
      );
    }
    return (
      <ScrollView contentContainerStyle={styles.listContent}>{chats.map(renderRow)}</ScrollView>
    );
  };

  return (
    <View style={styles.body}>
      {importMutation.isError ? (
        <Text style={styles.errorBanner}>
          {importMutation.error instanceof Error
            ? importMutation.error.message
            : t("cursorImport.importFailed")}
        </Text>
      ) : null}
      {renderBody()}
      {chats.length > 0 && !isUnavailable ? (
        <View style={styles.footer}>
          <PressHighlight
            onPress={toggleAll}
            accessibilityRole="button"
            style={styles.selectAllButton}
          >
            <Text style={styles.selectAll}>
              {isSelectAll ? t("cursorImport.clearSelection") : t("cursorImport.selectAll")}
            </Text>
          </PressHighlight>
          <Button
            variant="default"
            size="md"
            disabled={selected.size === 0}
            loading={importMutation.isPending}
            onPress={handleImportSelected}
          >
            {t("cursorImport.importSelected", { count: selected.size })}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    flex: 1,
    minHeight: 0,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  errorBanner: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[2],
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowHighlight: {
    backgroundColor: theme.colors.surface2,
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  importedBadge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  checkbox: {
    width: 20,
    height: 20,
    marginTop: 2,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  selectAllButton: {
    paddingVertical: theme.spacing[1],
  },
  selectAll: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
}));
