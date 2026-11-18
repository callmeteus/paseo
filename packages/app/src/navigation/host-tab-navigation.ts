import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";
import {
  getLastWorkspaceForHost,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { buildHostRootRoute } from "@/utils/host-routes";

/**
 * What a press on a host tab does, from anywhere in the app.
 *
 * Restores the last workspace opened on that host. A host that has never been
 * visited falls back to its root route, which resolves to its own open-project
 * screen.
 */
/**
 * A pinned host tab also filters the sidebar, and the pin outranks the route
 * when the rail decides which tab looks active. A deep link such as a
 * notification tap must retarget that pin, or it opens the right chat while the
 * previously pinned host stays highlighted.
 */
export function focusHostTab(serverId: string): void {
  const { hostFilters, setHostFilter } = useSidebarViewStore.getState();
  if (hostFilters.length !== 1 || hostFilters[0] === serverId) return;
  setHostFilter(serverId);
}

export function selectHostFromTab(hostServerId: string, currentServerId: string | null): void {
  if (!hostServerId || hostServerId === currentServerId) {
    return;
  }
  const remembered = getLastWorkspaceForHost(hostServerId);
  if (remembered) {
    navigateToWorkspace(remembered);
    return;
  }
  navigateToHostWorkspaceRoute(buildHostRootRoute(hostServerId));
}
