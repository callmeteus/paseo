import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { usePanelStore } from "@/stores/panel-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import {
  createLastWorkspaceSelectionStore,
  LAST_WORKSPACE_SELECTION_STORAGE_KEY,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionStorage,
} from "@/stores/last-workspace-selection";
import {
  createLastWorkspaceByHostStore,
  LAST_WORKSPACE_BY_HOST_STORAGE_KEY,
  type LastWorkspaceByHostStorage,
} from "@/stores/last-workspace-by-host";
import {
  navigateToLastWorkspace as navigateToLastWorkspacePure,
  navigateToWorkspace as navigateToWorkspacePure,
  parseActiveWorkspaceSelection,
  type NavigateToWorkspaceDeps,
  type NavigateToWorkspaceInput,
} from "./navigation";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit } from "@/utils/host-route-browser";
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";

export type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
export type { NavigateToWorkspaceInput } from "./navigation";

const lastWorkspaceSelectionStorage: LastWorkspaceSelectionStorage = {
  read: () => AsyncStorage.getItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
};

const lastWorkspaceSelectionStore = createLastWorkspaceSelectionStore(
  lastWorkspaceSelectionStorage,
);

const lastWorkspaceByHostStorage: LastWorkspaceByHostStorage = {
  read: () => AsyncStorage.getItem(LAST_WORKSPACE_BY_HOST_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(LAST_WORKSPACE_BY_HOST_STORAGE_KEY, value),
};

const lastWorkspaceByHostStore = createLastWorkspaceByHostStore(lastWorkspaceByHostStorage);

function rememberWorkspace(selection: ActiveWorkspaceSelection): void {
  lastWorkspaceSelectionStore.remember(selection);
  lastWorkspaceByHostStore.remember(selection);
}

function navigateDeps(): NavigateToWorkspaceDeps {
  return {
    revealTab: revealWorkspaceTab,
    revealWorkspace: (workspaceKey, surface) => {
      useWorkspaceLayoutStore.getState().focusWorkspace(workspaceKey);
      const panels = usePanelStore.getState();
      if (surface === "sidebar") panels.showMobileAgentList();
      else panels.showMobileAgent();
    },
    getSessionWorkspaces: (serverId) => useSessionStore.getState().sessions[serverId]?.workspaces,
    isWorkspaceLayoutHydrated: () => useWorkspaceLayoutStore.persist.hasHydrated(),
    deferOpenTab: (input) => useWorkspaceLayoutStore.getState().deferOpenTab(input),
    openTab: (input) => useWorkspaceLayoutStore.getState().openTab(input),
    rememberLastWorkspace: rememberWorkspace,
    navigateToRoute: (route) => {
      navigateToHostWorkspaceRoute(route);
      stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit();
    },
  };
}

export function hydrateLastWorkspaceSelection(): Promise<void> {
  return Promise.all([
    lastWorkspaceSelectionStore.hydrate(),
    lastWorkspaceByHostStore.hydrate(),
  ]).then(() => undefined);
}

/** The last workspace opened on a host, used by the host tab rail to switch hosts. */
export function getLastWorkspaceForHost(serverId: string): ActiveWorkspaceSelection | null {
  return lastWorkspaceByHostStore.getForHost(serverId);
}

export function getLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return lastWorkspaceSelectionStore.getSelection();
}

export function getIsLastWorkspaceSelectionHydrated(): boolean {
  return lastWorkspaceSelectionStore.isHydrated();
}

export function navigateToWorkspace(input: NavigateToWorkspaceInput): string {
  return navigateToWorkspacePure(input, navigateDeps());
}

export function navigateToLastWorkspace(): boolean {
  return navigateToLastWorkspacePure({
    ...navigateDeps(),
    getLastWorkspaceSelection: () => lastWorkspaceSelectionStore.getSelection(),
  });
}

export function useActiveWorkspaceSelection(): ActiveWorkspaceSelection | null {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const selection = parseActiveWorkspaceSelection({ pathname: usePathname(), params });
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    rememberWorkspace({ serverId, workspaceId });
  }, [serverId, workspaceId]);
  return selection;
}

export function useLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getLastWorkspaceSelection,
    getLastWorkspaceSelection,
  );
}

export function useIsLastWorkspaceSelectionHydrated(): boolean {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getIsLastWorkspaceSelectionHydrated,
    getIsLastWorkspaceSelectionHydrated,
  );
}

void hydrateLastWorkspaceSelection();
