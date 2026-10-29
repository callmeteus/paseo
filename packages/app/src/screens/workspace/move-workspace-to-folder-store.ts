import { useSyncExternalStore } from "react";

/** Which workspace the "Move workspace to folder" picker is open for. */
export interface MoveWorkspaceRequest {
  serverId: string;
  workspaceId: string;
}

let request: MoveWorkspaceRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openMoveWorkspaceToFolder(next: MoveWorkspaceRequest): void {
  request = next;
  emit();
}

export function closeMoveWorkspaceToFolder(): void {
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

export function useMoveWorkspaceToFolderRequest(): MoveWorkspaceRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
}
