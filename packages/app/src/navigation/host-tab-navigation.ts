import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";
import {
  getLastWorkspaceForHost,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import { buildHostRootRoute } from "@/utils/host-routes";

/**
 * What a press on a host tab does, from anywhere in the app.
 *
 * Restores the last workspace opened on that host. A host that has never been
 * visited falls back to its root route, which resolves to its own open-project
 * screen.
 */
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
