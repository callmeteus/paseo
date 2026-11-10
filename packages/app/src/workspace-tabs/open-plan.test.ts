import { beforeEach, expect, it } from "vitest";
import {
  findPaneById,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";
import { clearTabActivationGuard } from "@/workspace-tabs/navigation";
import { openPlanInExplorerSidebar } from "./open-plan";

const SERVER_ID = "srv_plan";
const WORKSPACE_ID = "wks_plan";
const WORKSPACE_KEY = `${SERVER_ID}:${WORKSPACE_ID}`;

beforeEach(() => {
  clearTabActivationGuard();
  useWorkspaceLayoutStore.setState({
    layoutMode: "split-panes",
    layoutByWorkspace: {},
    sheetsByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
  });
  usePanelStore.getState().showMobileAgent();
});

it("opens the plan file in the Explorer sidebar instead of the main pane", () => {
  const tabId = openPlanInExplorerSidebar({
    serverId: SERVER_ID,
    workspaceId: WORKSPACE_ID,
    path: "plans/feature.md",
    isCompact: false,
  });

  expect(tabId).toBeTruthy();
  const state = useWorkspaceLayoutStore.getState();
  const paneId = state.explorerSidebarPaneIdByWorkspace[WORKSPACE_KEY];
  expect(paneId).toBeTruthy();
  const explorerPane = findPaneById(state.layoutByWorkspace[WORKSPACE_KEY].root, paneId!);
  expect(explorerPane?.tabIds).toContain(tabId);
  expect(selectIsExplorerSidebarVisible(state, WORKSPACE_KEY)).toBe(true);
});

it("reveals the compact Explorer overlay when the plan opens there", () => {
  useWorkspaceLayoutStore.setState({ layoutMode: "compact" });

  const tabId = openPlanInExplorerSidebar({
    serverId: SERVER_ID,
    workspaceId: WORKSPACE_ID,
    path: "plans/feature.md",
    isCompact: true,
  });

  expect(tabId).toBeTruthy();
  expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
});
