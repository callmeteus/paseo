import { useSyncExternalStore } from "react";

/** The project the sidebar's "Edit workspace" sheet is open for. */
export interface EditWorkspaceRequest {
  serverId: string;
  projectViewKey: string;
}

let request: EditWorkspaceRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openEditWorkspace(next: EditWorkspaceRequest): void {
  request = next;
  emit();
}

export function closeEditWorkspace(): void {
  if (request === null) return;
  request = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useEditWorkspaceRequest(): EditWorkspaceRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
}
