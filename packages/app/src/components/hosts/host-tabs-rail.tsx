import { useCallback, type ReactElement } from "react";
import { usePathname } from "expo-router";
import { HostTabsRow } from "@/components/hosts/host-tabs-row";
import { selectHostFromTab } from "@/navigation/host-tab-navigation";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { parseServerIdFromPathname } from "@/utils/host-routes";

/**
 * The app-level host rail. Mounted once above the whole shell so it is present
 * on every screen — including /new — instead of only inside a workspace.
 *
 * A host tab is both navigation and a sidebar filter: selecting one pins the
 * sidebar to that host, and selecting the already-selected one shows every host
 * again. The single-host filter is also what marks the tab as selected, so the
 * rail and the sidebar always agree on which host you are looking at.
 */
export function HostTabsRail(): ReactElement | null {
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const setHostFilter = useSidebarViewStore((state) => state.setHostFilter);
  const pathname = usePathname();
  const lastSelection = useLastWorkspaceSelection();
  const filteredHostId = hostFilters.length === 1 ? hostFilters[0] : null;
  const activeServerId =
    filteredHostId ?? parseServerIdFromPathname(pathname) ?? lastSelection?.serverId ?? null;

  const handleSelectHost = useCallback(
    (serverId: string) => {
      const alreadySelected = filteredHostId === serverId;
      setHostFilter(alreadySelected ? null : serverId);
      if (!alreadySelected) {
        selectHostFromTab(serverId, activeServerId);
      }
    },
    [activeServerId, filteredHostId, setHostFilter],
  );

  if (groupMode !== "host_tabs") {
    return null;
  }
  return <HostTabsRow activeServerId={activeServerId} onSelectHost={handleSelectHost} />;
}
