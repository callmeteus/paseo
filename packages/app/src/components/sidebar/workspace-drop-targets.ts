import { useSyncExternalStore } from "react";

/**
 * Workspace rows as drop targets while a tab is dragged out of a pane.
 *
 * Tab drags run on a dnd-kit `DndContext` mounted inside the workspace screen, and the sidebar
 * lives outside that context. Rather than widening the DndContext across the whole app, rows
 * publish their DOM rects here and the drag scope hit-tests the pointer against them.
 */
export interface SidebarWorkspaceDropTargetNode {
  getBoundingClientRect?: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface SidebarWorkspaceDropTarget {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
}

export interface SidebarWorkspaceDropTargetHit extends SidebarWorkspaceDropTarget {
  node: SidebarWorkspaceDropTargetNode;
}

interface Registration {
  node: SidebarWorkspaceDropTargetNode;
  serverId: string;
  workspaceId: string;
}

const registrations = new Map<string, Registration>();
let hoveredWorkspaceKey: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function isDropTargetNode(value: unknown): value is SidebarWorkspaceDropTargetNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SidebarWorkspaceDropTargetNode).getBoundingClientRect === "function"
  );
}

export function registerSidebarWorkspaceDropTarget(input: {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  node: unknown;
}): void {
  if (!input.workspaceKey) return;
  if (isDropTargetNode(input.node)) {
    registrations.set(input.workspaceKey, {
      node: input.node,
      serverId: input.serverId,
      workspaceId: input.workspaceId,
    });
    return;
  }
  registrations.delete(input.workspaceKey);
  if (hoveredWorkspaceKey === input.workspaceKey) {
    setHoveredSidebarWorkspaceDropTarget(null);
  }
}

/**
 * The row under a viewport point, if any. Rows register their native view; on web that view is an
 * element with `getBoundingClientRect`. Native has no draggable tab layout, so a missing rect just
 * means nothing matches.
 */
export function findSidebarWorkspaceDropTargetAtPoint(
  x: number,
  y: number,
): SidebarWorkspaceDropTargetHit | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const [workspaceKey, registration] of registrations) {
    const rect = registration.node.getBoundingClientRect?.();
    if (!rect) continue;
    if (
      x >= rect.left &&
      x <= rect.left + rect.width &&
      y >= rect.top &&
      y <= rect.top + rect.height
    ) {
      return {
        workspaceKey,
        serverId: registration.serverId,
        workspaceId: registration.workspaceId,
        node: registration.node,
      };
    }
  }
  return null;
}

export function setHoveredSidebarWorkspaceDropTarget(workspaceKey: string | null): void {
  if (hoveredWorkspaceKey === workspaceKey) return;
  hoveredWorkspaceKey = workspaceKey;
  emit();
}

export function getHoveredSidebarWorkspaceDropTarget(): string | null {
  return hoveredWorkspaceKey;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Workspace key of the row currently under a dragged tab, for drop highlighting. */
export function useHoveredSidebarWorkspaceDropTarget(): string | null {
  return useSyncExternalStore(
    subscribe,
    getHoveredSidebarWorkspaceDropTarget,
    getHoveredSidebarWorkspaceDropTarget,
  );
}

/** Test seam: drops every registration and hover so tests stay isolated. */
export function resetSidebarWorkspaceDropTargets(): void {
  registrations.clear();
  hoveredWorkspaceKey = null;
  listeners.clear();
}
