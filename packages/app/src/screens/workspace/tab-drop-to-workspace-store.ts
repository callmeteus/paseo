import { useSyncExternalStore } from "react";

/**
 * A tab dropped on a sidebar workspace row: which chat, on which host, and where it landed.
 * Kept outside React because the drag scope deep in the pane layout is the one that opens it.
 */
export interface TabDropToWorkspaceRequest {
  agentId: string;
  serverId: string;
  targetWorkspaceId: string;
}

let request: TabDropToWorkspaceRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openTabDropToWorkspace(next: TabDropToWorkspaceRequest): void {
  request = next;
  emit();
}

export function closeTabDropToWorkspace(): void {
  if (request !== null) {
    request = null;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTabDropToWorkspaceRequest(): TabDropToWorkspaceRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
}
