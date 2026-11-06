import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";

const TAB_ACTIVATION_GUARD_MS = 500;
let guardedTabId: string | null = null;
let guardUntil = 0;

/**
 * The click that creates a tab can fall through onto the tab that was underneath
 * the menu. Until this expires, only `tabId` may be revealed.
 */
export function guardTabActivation(tabId: string): void {
  guardedTabId = tabId;
  guardUntil = Date.now() + TAB_ACTIVATION_GUARD_MS;
}

export function clearTabActivationGuard(): void {
  guardedTabId = null;
  guardUntil = 0;
}

function isForeignTabActivation(tabId: string): boolean {
  return Date.now() < guardUntil && tabId !== guardedTabId;
}

/** Reveals the actual destination after placement and deduplication, including existing tabs. */
export function revealWorkspaceTab(workspaceKey: string, tabId: string | null): string | null {
  if (!tabId || isForeignTabActivation(tabId)) return null;
  const store = useWorkspaceLayoutStore.getState();
  const destination = store.getTabDestination(workspaceKey, tabId);
  // Opening a sheet already reveals it, preserving the surface underneath.
  if (!destination) return null;
  if (destination.kind === "sheet") return tabId;
  store.focusTab(workspaceKey, tabId);
  if (store.layoutMode === "compact") {
    const panels = usePanelStore.getState();
    if (destination.host === "explorer") panels.showMobileFileExplorer();
    else panels.showMobileAgent();
  }
  return tabId;
}
