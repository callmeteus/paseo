import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRight, Copy, FolderInput } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ScrollView } from "@/components/ui/scroll-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import {
  requestSidebarReveal,
  workspaceKeyForSidebarRow,
} from "@/components/sidebar/sidebar-reveal";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import {
  closeTabDropToWorkspace,
  useTabDropToWorkspaceRequest,
} from "@/screens/workspace/tab-drop-to-workspace-store";
import { workspaceIsEmptyAfterMove } from "@/screens/workspace/workspace-empty-after-move";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedCopy = withUnistyles(Copy);
const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type DropAction = "move" | "copy";

function ActionRow({
  variant,
  title,
  description,
  pending,
  disabled,
  testID,
  onPress,
}: {
  variant: "move" | "copy";
  title: string;
  description: string;
  pending: boolean;
  disabled: boolean;
  testID: string;
  onPress: () => void;
}) {
  const rowStyle = useMemo(() => [styles.row, disabled && styles.rowDisabled], [disabled]);
  const icon =
    variant === "move" ? (
      <ThemedFolderInput size={ICON_SIZE.sm} uniProps={mutedMapping} />
    ) : (
      <ThemedCopy size={ICON_SIZE.sm} uniProps={mutedMapping} />
    );
  return (
    <PressHighlight
      disabled={disabled}
      onPress={onPress}
      highlightStyle={styles.rowActive}
      style={rowStyle}
      testID={testID}
    >
      {icon}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={2}>
          {description}
        </Text>
      </View>
      {pending ? (
        <ThemedLoadingSpinner size="small" uniProps={mutedMapping} />
      ) : (
        <ThemedArrowRight size={ICON_SIZE.sm} uniProps={mutedMapping} />
      )}
    </PressHighlight>
  );
}

function resolveEmptySourceWorkspace(input: {
  session: SessionState | null;
  sourceWorkspaceId: string | undefined;
  movedAgentId: string;
}): { sourceName: string; isEmpty: boolean } {
  const sourceWorkspace = input.sourceWorkspaceId
    ? (input.session?.workspaces.get(input.sourceWorkspaceId) ?? null)
    : null;
  const sourceName = sourceWorkspace?.title?.trim() || sourceWorkspace?.name || "";
  if (!sourceName) {
    return { sourceName: "", isEmpty: false };
  }
  return {
    sourceName,
    isEmpty: workspaceIsEmptyAfterMove({
      agents: input.session?.agents ?? new Map(),
      agentDetails: input.session?.agentDetails,
      sourceWorkspaceId: input.sourceWorkspaceId,
      movedAgentId: input.movedAgentId,
    }),
  };
}

export function TabDropToWorkspaceSheet() {
  const { t } = useTranslation();
  const toast = useToast();
  const request = useTabDropToWorkspaceRequest();
  const [pendingAction, setPendingAction] = useState<DropAction | null>(null);

  const session = useSessionStore((state) => (request ? state.sessions[request.serverId] : null));
  const agent = request ? (session?.agents.get(request.agentId) ?? null) : null;
  const targetWorkspace = request
    ? (session?.workspaces.get(request.targetWorkspaceId) ?? null)
    : null;
  const client = session?.client ?? null;
  const visible = Boolean(request && agent && targetWorkspace && client);
  const workspaceName = targetWorkspace?.title?.trim() || targetWorkspace?.name || "";
  const agentName = agent?.title?.trim() || t("workspace.tabs.fallback.agent");
  const header = useMemo(() => ({ title: t("workspace.tabs.dropToWorkspace.title") }), [t]);

  const buildCloneConfig = useCallback(() => {
    if (!agent) return null;
    const featureValues: Record<string, unknown> = {};
    for (const feature of agent.features ?? []) {
      featureValues[feature.id] = feature.value;
    }
    const cwd = targetWorkspace?.workspaceDirectory?.trim() || agent.cwd;
    return {
      ...buildWorkspaceDraftAgentConfig({
        provider: agent.provider,
        cwd,
        ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
        ...(agent.workflowModeId ? { workflowModeId: agent.workflowModeId } : {}),
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.thinkingOptionId ? { thinkingOptionId: agent.thinkingOptionId } : {}),
        featureValues,
      }),
      ...(agent.title?.trim() ? { title: agent.title.trim() } : {}),
    };
  }, [agent, targetWorkspace]);

  const handleMove = useCallback(async () => {
    if (!client || !agent || !request || pendingAction) return;
    setPendingAction("move");
    const sourceWorkspaceId = agent.workspaceId;
    try {
      await client.setAgentWorkspace(agent.id, request.targetWorkspaceId);
      requestSidebarReveal(
        workspaceKeyForSidebarRow({
          serverId: request.serverId,
          workspaceId: request.targetWorkspaceId,
        }),
      );
      navigateToAgent({ serverId: request.serverId, agentId: agent.id });
      const { sourceName, isEmpty: sourceIsEmpty } = resolveEmptySourceWorkspace({
        session,
        sourceWorkspaceId,
        movedAgentId: agent.id,
      });
      toast.show(
        sourceIsEmpty
          ? t("workspace.tabs.dropToWorkspace.movedLeavingEmpty", {
              workspace: workspaceName,
              source: sourceName,
            })
          : t("workspace.tabs.dropToWorkspace.moved", { workspace: workspaceName }),
        { variant: sourceIsEmpty ? "warning" : "info" },
      );
      closeTabDropToWorkspace();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.tabs.dropToWorkspace.moveFailed"),
      );
    } finally {
      setPendingAction(null);
    }
  }, [agent, client, pendingAction, request, session, t, toast, workspaceName]);

  const handleCopy = useCallback(async () => {
    const config = buildCloneConfig();
    if (!client || !agent || !request || !config || pendingAction) return;
    setPendingAction("copy");
    try {
      const created = await client.createAgent({
        workspaceId: request.targetWorkspaceId,
        config,
      });
      requestSidebarReveal(
        workspaceKeyForSidebarRow({
          serverId: request.serverId,
          workspaceId: request.targetWorkspaceId,
        }),
      );
      navigateToWorkspace({
        serverId: request.serverId,
        workspaceId: request.targetWorkspaceId,
        target: { kind: "agent", agentId: created.id },
      });
      toast.show(t("workspace.tabs.dropToWorkspace.copied", { workspace: workspaceName }), {
        variant: "info",
      });
      closeTabDropToWorkspace();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.tabs.dropToWorkspace.copyFailed"),
      );
    } finally {
      setPendingAction(null);
    }
  }, [agent, buildCloneConfig, client, pendingAction, request, t, toast, workspaceName]);

  const close = useCallback(() => {
    if (pendingAction) return;
    closeTabDropToWorkspace();
  }, [pendingAction]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={close}
      testID="tab-drop-to-workspace-sheet"
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.message}>
          {t("workspace.tabs.dropToWorkspace.message", { agent: agentName })}
        </Text>
        <ActionRow
          variant="move"
          title={t("workspace.tabs.dropToWorkspace.move", { workspace: workspaceName })}
          description={t("workspace.tabs.dropToWorkspace.moveHint")}
          pending={pendingAction === "move"}
          disabled={pendingAction !== null}
          testID="tab-drop-to-workspace-move"
          onPress={handleMove}
        />
        <ActionRow
          variant="copy"
          title={t("workspace.tabs.dropToWorkspace.copy", { workspace: workspaceName })}
          description={t("workspace.tabs.dropToWorkspace.copyHint")}
          pending={pendingAction === "copy"}
          disabled={pendingAction !== null}
          testID="tab-drop-to-workspace-copy"
          onPress={handleCopy}
        />
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
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
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
