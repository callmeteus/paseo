import { useSyncExternalStore } from "react";

/**
 * Which chat the "Promote to workspace" sheet is open for. Kept outside React
 * so a tab menu deep in the layout can open the sheet without threading a
 * callback through every tab row.
 */
let requestedAgentId: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openPromoteAgentToWorkspace(agentId: string): void {
  requestedAgentId = agentId;
  emit();
}

export function closePromoteAgentToWorkspace(): void {
  if (requestedAgentId !== null) {
    requestedAgentId = null;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePromoteAgentToWorkspaceAgentId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => requestedAgentId,
    () => null,
  );
}
