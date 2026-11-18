import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, FolderInput } from "lucide-react-native";
import { CommandPanel, CommandPanelRow } from "@/components/ui/command-panel";
import { ScrollView } from "@/components/ui/scroll-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import {
  requestSidebarReveal,
  workspaceKeyForSidebarRow,
} from "@/components/sidebar/sidebar-reveal";
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
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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
  let trailing;
  if (moving) {
    trailing = <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />;
  } else if (row.isCurrent) {
    trailing = <ThemedCheck size={ICON_SIZE.sm} uniProps={mutedMapping} />;
  }

  return (
    <CommandPanelRow
      disabled={disabled}
      onPress={handlePress}
      testID={`move-agent-to-workspace-${row.id}`}
      title={row.name}
      meta={`${row.project} · ${row.directory}`}
      trailing={trailing}
    >
      <ThemedFolderInput size={ICON_SIZE.sm} uniProps={mutedMapping} />
    </CommandPanelRow>
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
        requestSidebarReveal(workspaceKeyForSidebarRow({ serverId, workspaceId: row.id }));
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
    <CommandPanel
      title={t("workspace.tabs.menu.moveChat.title")}
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
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    textAlign: "center",
  },
}));
