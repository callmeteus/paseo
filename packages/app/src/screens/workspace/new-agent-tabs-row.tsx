import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useRouter } from "expo-router";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import {
  WorkspaceDesktopTabsRow,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import { generateDraftId } from "@/stores/draft-keys";
import { buildNewAgentRoute } from "@/utils/host-routes";
import type { Href } from "expo-router";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import { NewTabLauncherProvider, type NewTabLauncher } from "@/workspace-tabs/launcher";
import type { NewTabSelection } from "@/workspace-tabs/new-tab";

const noop = () => undefined;

/**
 * The new-agent setup route lives outside WorkspaceScreen, which normally owns
 * the workspace tab strip. Render the strip here as well so opening a new chat
 * does not make the open tabs disappear from the top of the app.
 */
export function NewAgentTabsRow({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement | null {
  // This route renders the tab strip outside WorkspaceScreen, so neither the panels nor the
  // launcher that the new-tab menu needs have been set up. The new-tab menu mounts lazily and
  // would otherwise throw an invariant from useWorkspaceTabLaunchCatalog.
  ensurePanelsRegistered();
  const router = useRouter();
  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId }) ?? "";
  const workspaceLayout = useWorkspaceLayoutStore((state) =>
    persistenceKey ? (state.layoutByWorkspace[persistenceKey] ?? null) : null,
  );
  const uiTabs = useMemo(
    () => (workspaceLayout ? collectAllTabs(workspaceLayout.root) : []),
    [workspaceLayout],
  );
  const paneState = useMemo(
    () =>
      deriveWorkspacePaneState({
        layout: workspaceLayout,
        tabs: uiTabs,
        paneId: workspaceLayout?.focusedPaneId ?? "",
      }),
    [uiTabs, workspaceLayout],
  );
  const tabs = useMemo<WorkspaceDesktopTabRowItem[]>(
    () =>
      paneState.tabs.map((tab) => ({
        tab: tab.descriptor,
        isActive: tab.descriptor.tabId === paneState.activeTabId,
        isCloseHovered: hoveredCloseTabKey === tab.descriptor.key,
        isClosingTab: false,
      })),
    [hoveredCloseTabKey, paneState.activeTabId, paneState.tabs],
  );

  const onNavigateTab = useCallback(
    (tabId: string) => {
      const tab = paneState.tabs.find((entry) => entry.descriptor.tabId === tabId);
      if (!tab) return;
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: tab.descriptor.target as WorkspaceTabTarget,
      });
    },
    [paneState.tabs, serverId, workspaceId],
  );

  const onCloseTab = useCallback(
    (tabId: string) => {
      if (persistenceKey) {
        useWorkspaceLayoutStore.getState().closeTab(persistenceKey, tabId);
      }
    },
    [persistenceKey],
  );

  const openDraft = useCallback(
    (draftId: string, openui?: boolean) =>
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "draft", draftId, ...(openui ? { openui: true } : {}) },
      }),
    [serverId, workspaceId],
  );
  const launcher = useMemo<NewTabLauncher>(
    () => ({
      showChanges: false,
      showPullRequest: false,
      showBrowser: false,
      terminalDisabled: true,
      launch: (selection: NewTabSelection) => {
        if (selection.kind === "agent") {
          router.push(
            buildNewAgentRoute({
              serverId,
              workspaceId,
              draftId: generateDraftId(),
            }) as Href,
          );
          return;
        }
        if (selection.kind === "chat") {
          openDraft(generateDraftId(), true);
          return;
        }
        if (selection.kind === "target") {
          navigateToWorkspace({ serverId, workspaceId, target: selection.target });
        }
      },
    }),
    [openDraft, router, serverId, workspaceId],
  );
  const onCreateNewTab = useCallback(() => {
    router.push(
      buildNewAgentRoute({
        serverId,
        workspaceId,
        draftId: generateDraftId(),
      }) as Href,
    );
  }, [router, serverId, workspaceId]);

  if (!persistenceKey) return null;

  return (
    <NewTabLauncherProvider value={launcher}>
      <WorkspaceDesktopTabsRow
        paneId={paneState.pane?.id}
        isFocused={true}
        tabs={tabs}
        normalizedServerId={serverId}
        normalizedWorkspaceId={workspaceId}
        setHoveredCloseTabKey={setHoveredCloseTabKey}
        onNavigateTab={onNavigateTab}
        onCloseTab={onCloseTab}
        onCopyResumeCommand={noop}
        onCopyAgentId={noop}
        onCopyTerminalId={noop}
        onCopyFilePath={noop}
        onReloadAgent={noop}
        onRenameTab={noop}
        onCloseTabsToLeft={noop}
        onCloseTabsToRight={noop}
        onCloseOtherTabs={noop}
        onCreateNewTab={onCreateNewTab}
        onReorderTabs={noop}
        focusModeEnabled={false}
        onExitFocusMode={noop}
      />
    </NewTabLauncherProvider>
  );
}
