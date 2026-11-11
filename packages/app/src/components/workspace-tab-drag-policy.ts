export function acceptsWorkspaceTabDrop(
  allowCrossPane: boolean,
  sourcePaneId: string,
  destination: { kind: "workspace-tab" | "split-pane-drop"; paneId: string },
): boolean {
  return (
    allowCrossPane || (destination.kind === "workspace-tab" && sourcePaneId === destination.paneId)
  );
}

export interface WorkspaceTabSidebarTarget {
  workspaceKey: string;
  workspaceId: string;
  agentId: string;
}

export type WorkspaceTabDropResolution =
  | ({ kind: "workspace" } & WorkspaceTabSidebarTarget)
  | { kind: "tab" }
  | { kind: "pane" }
  | null;

/**
 * Which drop wins when a tab is released.
 *
 * Sidebar rows are not dnd-kit droppables, so `over` always comes from the pane layout — even when
 * the pointer sits over the sidebar, where the closest pane wins. A sidebar row under the pointer
 * therefore has to beat `over`; otherwise the drop resolves against a pane the user is not pointing
 * at and nothing happens.
 */
export function resolveWorkspaceTabDrop(input: {
  sidebarTarget: WorkspaceTabSidebarTarget | null;
  sourcePaneId: string | null;
  over: { kind: "workspace-tab" | "split-pane-drop"; paneId: string } | null;
  allowCrossPane: boolean;
}): WorkspaceTabDropResolution {
  if (input.sidebarTarget) {
    return { kind: "workspace", ...input.sidebarTarget };
  }
  if (!input.sourcePaneId || !input.over) {
    return null;
  }
  if (!acceptsWorkspaceTabDrop(input.allowCrossPane, input.sourcePaneId, input.over)) {
    return null;
  }
  return { kind: input.over.kind === "workspace-tab" ? "tab" : "pane" };
}
