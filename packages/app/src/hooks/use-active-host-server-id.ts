import { usePathname } from "expo-router";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { resolveActiveHostServerId } from "@/utils/active-host";

export function useActiveHostServerId(): string | null {
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const pathname = usePathname();
  const lastSelection = useLastWorkspaceSelection();

  return resolveActiveHostServerId({
    hostFilters,
    pathname,
    lastServerId: lastSelection?.serverId,
  });
}
