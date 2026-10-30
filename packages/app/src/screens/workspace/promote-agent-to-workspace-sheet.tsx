import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  closePromoteAgentToWorkspace,
  usePromoteAgentToWorkspaceAgentId,
} from "@/screens/workspace/promote-agent-to-workspace-store";

function findWorkspaceAtDirectory(
  workspaces: Map<string, WorkspaceDescriptor> | undefined,
  cwd: string,
): WorkspaceDescriptor | undefined {
  return [...(workspaces?.values() ?? [])].find(
    (workspace) => !workspace.archivingAt && workspace.workspaceDirectory === cwd,
  );
}

function workspaceDisplayName(workspace: WorkspaceDescriptor): string {
  return workspace.title?.trim() || workspace.name;
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

/**
 * Gives an agent its own workspace at its current directory. Subagents are
 * detached first so the promoted chat is no longer a child of another track.
 */
export function PromoteAgentToWorkspaceSheet() {
  const { t } = useTranslation();
  const toast = useToast();
  const agentId = usePromoteAgentToWorkspaceAgentId();
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
  const [promoting, setPromoting] = useState(false);
  const visible = Boolean(agentId && serverId && agent);
  const sheetHeader = useMemo(() => ({ title: t("workspace.tabs.menu.promoteChat.title") }), [t]);

  const handlePromote = useCallback(async () => {
    if (!client || !agent || !serverId || promoting) return;
    setPromoting(true);
    try {
      if (agent.parentAgentId) {
        await client.detachAgent(agent.id);
      }

      const existing = findWorkspaceAtDirectory(workspaces, agent.cwd);
      let workspaceId = existing?.id;
      let workspaceName = existing ? workspaceDisplayName(existing) : null;

      if (!workspaceId) {
        const created = await client.createWorkspace({
          source: { kind: "directory", path: agent.cwd },
          title: agent.title?.trim() || undefined,
        });
        if (!created.workspace) {
          throw new Error(t("workspace.tabs.menu.promoteChat.failed"));
        }
        workspaceId = created.workspace.id;
        workspaceName = workspaceDisplayName(created.workspace);
      }

      await client.setAgentWorkspace(agent.id, workspaceId);
      navigateToAgent({ serverId, agentId: agent.id });
      toast.show(
        t("workspace.tabs.menu.promoteChat.promoted", {
          workspace: workspaceName ?? workspaceId,
        }),
        { variant: "success" },
      );
      closePromoteAgentToWorkspace();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.tabs.menu.promoteChat.failed"),
      );
    } finally {
      setPromoting(false);
    }
  }, [agent, client, promoting, serverId, t, toast, workspaces]);

  return (
    <AdaptiveModalSheet
      header={sheetHeader}
      visible={visible}
      onClose={closePromoteAgentToWorkspace}
      testID="promote-agent-to-workspace-sheet"
    >
      <View style={styles.content}>
        <Text style={styles.body}>
          {t("workspace.tabs.menu.promoteChat.body", { cwd: agent?.cwd ?? "" })}
        </Text>
        <View style={styles.actions}>
          <Button
            variant="outline"
            size="md"
            onPress={closePromoteAgentToWorkspace}
            disabled={promoting}
          >
            {t("workspace.tabs.menu.promoteChat.cancel")}
          </Button>
          <Button variant="default" size="md" loading={promoting} onPress={handlePromote}>
            {t("workspace.tabs.menu.promoteChat.confirmLabel")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[6],
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
