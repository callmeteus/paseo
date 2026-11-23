import { useCallback, type ReactElement } from "react";
import { HostTabsRow } from "@/components/hosts/host-tabs-row";
import { useActiveHostServerId } from "@/hooks/use-active-host-server-id";
import { selectHostFromTab } from "@/navigation/host-tab-navigation";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarViewStore, type SidebarGroupMode } from "@/stores/sidebar-view-store";

export function isHostTabsRailVisible(input: {
  groupMode: SidebarGroupMode;
  hostCount: number;
}): boolean {
  return input.groupMode === "host_tabs" && input.hostCount > 1;
}

/**
 * The app-level host rail. Mounted once above the whole shell so it is present
 * on every screen — including /new — instead of only inside a workspace.
 *
 * A host tab is both navigation and a sidebar filter: selecting one pins the
 * sidebar to that host. The "General" tab clears the filter and shows every host,
 * so re-clicking a host no longer silently toggles it off.
 */
export function HostTabsRail(): ReactElement | null {
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const hostCount = useHosts().length;
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const setHostFilter = useSidebarViewStore((state) => state.setHostFilter);
  const clearHostFilters = useSidebarViewStore((state) => state.clearHostFilters);
  const showAllActive = hostFilters.length === 0;
  const activeServerId = useActiveHostServerId();

  const handleSelectHost = useCallback(
    (serverId: string) => {
      setHostFilter(serverId);
      selectHostFromTab(serverId, activeServerId);
    },
    [activeServerId, setHostFilter],
  );

  if (!isHostTabsRailVisible({ groupMode, hostCount })) {
    return null;
  }
  return (
    <HostTabsRow
      activeServerId={activeServerId}
      onSelectHost={handleSelectHost}
      showAllActive={showAllActive}
      onSelectAll={clearHostFilters}
    />
  );
}
