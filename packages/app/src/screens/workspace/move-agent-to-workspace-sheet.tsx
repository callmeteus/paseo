import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRight, Check, FolderInput } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  closeMoveAgentToWorkspace,
  useMoveAgentToWorkspaceAgentId,
} from "@/screens/workspace/move-agent-to-workspace-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedCheck = withUnistyles(Check);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

interface WorkspaceMoveRowModel {
  id: string;
  name: string;
  project: string;
  directory: string;
  isCurrent: boolean;
  sameDirectory: boolean;
}

function resolveAgentServerId(agentId: string | null): string | null {
  if (!agentId) return null;
  const sessions = useSessionStore.getState().sessions;
  for (const [serverId, session] of Object.entries(sessions)) {
    if (session.agents?.has(agentId)) {
      return serverId;
    }
  }
  return null;
}

function WorkspaceMoveRow({
  row,
  disabled,
  moving,
  onSelect,
}: {
  row: WorkspaceMoveRowModel;
  disabled: boolean;
  moving: boolean;
  onSelect: (workspaceId: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(row.id), [onSelect, row.id]);
  const rowStyle = useMemo(() => [styles.row, disabled && styles.rowDisabled], [disabled]);
  let trailing;
  if (moving) {
    trailing = <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />;
  } else if (row.isCurrent) {
    trailing = <ThemedCheck size={ICON_SIZE.sm} uniProps={accentMapping} />;
  } else {
    trailing = <ThemedArrowRight size={ICON_SIZE.sm} uniProps={mutedMapping} />;
  }

  return (
    <PressHighlight
      disabled={disabled}
      onPress={handlePress}
      highlightStyle={styles.rowActive}
      style={rowStyle}
      testID={`move-agent-to-workspace-${row.id}`}
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

/**
 * Reassigns a chat's workspace ownership. The chat keeps running in its current
 * cwd; the workspace it belongs to is what changes. Moving into a workspace
 * backed by a different directory asks for confirmation first.
 */
export function MoveAgentToWorkspaceSheet() {
  const { t } = useTranslation();
  const toast = useToast();
  const agentId = useMoveAgentToWorkspaceAgentId();
  const serverId = useSessionStore(() => resolveAgentServerId(agentId));
  const client = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.client ?? null) : null,
  );
  const agent = useSessionStore((state) =>
    agentId && serverId ? (state.sessions[serverId]?.agents.get(agentId) ?? null) : null,
  );
  const workspaces = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.workspaces : undefined,
  );
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const visible = Boolean(agentId && serverId && agent);
  const sheetHeader = useMemo(() => ({ title: t("workspace.tabs.menu.moveChat.title") }), [t]);

  const rows = useMemo<WorkspaceMoveRowModel[]>(() => {
    const currentWorkspaceId = agent?.workspaceId ?? null;
    return [...(workspaces?.values() ?? [])]
      .filter((workspace) => !workspace.archivingAt)
      .sort((left, right) => {
        if (left.id === currentWorkspaceId) return -1;
        if (right.id === currentWorkspaceId) return 1;
        return left.name.localeCompare(right.name);
      })
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.title?.trim() || workspace.name,
        project: workspace.projectDisplayName,
        directory: workspace.workspaceDirectory,
        isCurrent: workspace.id === currentWorkspaceId,
        sameDirectory: workspace.workspaceDirectory === agent?.cwd,
      }));
  }, [agent?.cwd, agent?.workspaceId, workspaces]);

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      const row = rows.find((entry) => entry.id === workspaceId);
      if (!client || !agent || !serverId || !row || row.isCurrent || movingTo) return;
      if (!row.sameDirectory) {
        const confirmed = await confirmDialog({
          title: t("workspace.tabs.menu.moveChat.confirmTitle"),
          message: t("workspace.tabs.menu.moveChat.confirmBody", {
            cwd: agent.cwd,
            target: row.directory,
          }),
          confirmLabel: t("workspace.tabs.menu.moveChat.confirmLabel"),
        });
        if (!confirmed) return;
      }
      setMovingTo(row.id);
      try {
        await client.setAgentWorkspace(agent.id, row.id);
        navigateToAgent({ serverId, agentId: agent.id });
        toast.show(t("workspace.tabs.menu.moveChat.moved", { workspace: row.name }), {
          variant: "info",
        });
        closeMoveAgentToWorkspace();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.menu.moveChat.failed"),
        );
      } finally {
        setMovingTo(null);
      }
    },
    [agent, client, movingTo, rows, serverId, t, toast],
  );

  return (
    <AdaptiveModalSheet
      header={sheetHeader}
      visible={visible}
      onClose={closeMoveAgentToWorkspace}
      testID="move-agent-to-workspace-sheet"
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {rows.length <= 1 ? (
          <Text style={styles.empty}>{t("workspace.tabs.menu.moveChat.empty")}</Text>
        ) : (
          rows.map((row) => (
            <WorkspaceMoveRow
              key={row.id}
              row={row}
              disabled={row.isCurrent || movingTo !== null}
              moving={movingTo === row.id}
              onSelect={selectWorkspace}
            />
          ))
        )}
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
}));
