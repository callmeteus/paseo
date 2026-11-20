import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { NewAgentTabsRow } from "@/screens/workspace/new-agent-tabs-row";
import { useIsCompactFormFactor } from "@/constants/layout";
import { WorkspaceDraftAgentTab } from "@/composer/draft/workspace-tab";
import { useImportSession } from "@/hooks/use-import-session";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { generateDraftId } from "@/stores/draft-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { applyLegacyDaemonWorkspaceOwnership } from "@/workspace/legacy-daemon-workspaces";
import { createWorkspaceFileTabTarget } from "@/workspace/file-open";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

export interface NewAgentScreenProps {
  serverId: string;
  workspaceId: string;
  draftId?: string;
}

/**
 * Full-screen agent setup for a workspace that is already chosen. It reuses the
 * draft tab's composer and create flow; only the presentation and the landing
 * target differ from opening a draft tab inside the workspace.
 */
export function NewAgentScreen({ serverId, workspaceId, draftId }: NewAgentScreenProps) {
  const { t } = useTranslation();
  const [creationDraftId] = useState(() => draftId?.trim() || generateDraftId());
  const importSession = useImportSession({ serverId, workspaceId });
  const isCompact = useIsCompactFormFactor();

  const handleCreated = useCallback(
    (snapshot: AgentSnapshotPayload) => {
      const normalized = normalizeAgentSnapshot(snapshot, serverId);
      const agent = applyLegacyDaemonWorkspaceOwnership({ serverId, agent: normalized });
      getHostRuntimeStore().acceptAgentSnapshot(serverId, agent);
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "agent", agentId: snapshot.id },
        // The directory may still list the old workspace when this tab opens.
        // Pin it so a late hydration cannot prune it and fall back to the
        // previous chat.
        pin: true,
      });
    },
    [serverId, workspaceId],
  );

  const handleOpenWorkspaceFile = useCallback(
    (request: { location: Parameters<typeof createWorkspaceFileTabTarget>[0] }) => {
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: createWorkspaceFileTabTarget(request.location),
      });
    },
    [serverId, workspaceId],
  );

  return (
    <>
      {isCompact ? null : <NewAgentTabsRow serverId={serverId} workspaceId={workspaceId} />}
      <MenuHeader borderless />
      <WorkspaceDraftAgentTab
        serverId={serverId}
        workspaceId={workspaceId}
        tabId={creationDraftId}
        draftId={creationDraftId}
        isPaneFocused={true}
        onCreated={handleCreated}
        onOpenWorkspaceFile={handleOpenWorkspaceFile}
        onOpenImportSheet={importSession.open}
        setupPresentation={true}
        heroTitle={t("workspace.tabs.actions.newAgent")}
      />
      {importSession.sheet}
    </>
  );
}
