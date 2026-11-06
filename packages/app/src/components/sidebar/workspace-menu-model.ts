/**
 * Order of the workspace row menu (the chat three-dots menu and the same
 * right-click menu). Groups are separated only when both sides have a row.
 * Pin is one row: the label switches with `workspacePinAction`.
 */
export const WORKSPACE_MENU_GROUPS = [
  ["archive"],
  ["pin"],
  ["rename", "labels", "mark-as-read", "mark-as-unread"],
  ["move", "copy-path", "copy-branch", "open-folder"],
  ["delete"],
] as const;

export type WorkspaceMenuAction = (typeof WORKSPACE_MENU_GROUPS)[number][number];

/** One divider, named by the first action of the group it introduces. */
export type WorkspaceMenuSeparator = `separator-before-${WorkspaceMenuAction}`;

export type WorkspaceMenuRow = WorkspaceMenuAction | WorkspaceMenuSeparator;

export function isWorkspaceMenuSeparator(row: WorkspaceMenuRow): row is WorkspaceMenuSeparator {
  return row.startsWith("separator-before-");
}

export type WorkspacePinAction = "pin" | "unpin";

/** One label for the pin row. Pinned chats offer unpin, and the other way around. */
export function workspacePinAction(isPinned: boolean): WorkspacePinAction {
  return isPinned ? "unpin" : "pin";
}

/**
 * Visible rows, in menu order. A flag that is absent or false is omitted,
 * and so is the divider that would have sat next to an empty group.
 */
export function workspaceMenuRows(
  visible: Partial<Record<WorkspaceMenuAction, boolean>>,
): WorkspaceMenuRow[] {
  const rows: WorkspaceMenuRow[] = [];
  for (const group of WORKSPACE_MENU_GROUPS) {
    const actions = group.filter((action) => visible[action] === true);
    if (actions.length === 0) continue;
    if (rows.length > 0) rows.push(`separator-before-${actions[0]}`);
    rows.push(...actions);
  }
  return rows;
}
