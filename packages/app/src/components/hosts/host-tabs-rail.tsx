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
 */
export function HostTabsRail(): ReactElement | null {
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const pathname = usePathname();
  const lastSelection = useLastWorkspaceSelection();
  const activeServerId = parseServerIdFromPathname(pathname) ?? lastSelection?.serverId ?? null;
  const handleSelectHost = useCallback(
    (serverId: string) => selectHostFromTab(serverId, activeServerId),
    [activeServerId],
  );

  if (groupMode !== "host_tabs") {
    return null;
  }
  return <HostTabsRow activeServerId={activeServerId} onSelectHost={handleSelectHost} />;
}
