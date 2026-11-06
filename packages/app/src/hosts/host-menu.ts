import { HOST_COLORS, type HostColor } from "@/hosts/appearance";
import { identityForeground } from "@/styles/identity-colors";

/**
 * Rows of the host header's context menu, in the order they are drawn.
 * Rename writes `HostProfile.label`, color writes `HostProfile.appearance.color`,
 * and remove goes through `removeHost`. Nothing here has a store of its own.
 */
export const HOST_CONTEXT_MENU_ACTIONS = ["rename", "color", "remove"] as const;

export type HostContextMenuAction = (typeof HOST_CONTEXT_MENU_ACTIONS)[number];

export type HostContextMenuRow = HostContextMenuAction | "separator";

/**
 * The rows the host menu draws, in the order of `HOST_CONTEXT_MENU_ACTIONS`.
 * Remove is the destructive group, so a separator sits in front of it when
 * another action comes first.
 */
export function hostContextMenuRows(): HostContextMenuRow[] {
  const rows: HostContextMenuRow[] = [];
  for (const action of HOST_CONTEXT_MENU_ACTIONS) {
    if (action === "remove" && rows.length > 0) {
      rows.push("separator");
    }
    rows.push(action);
  }
  return rows;
}

/** The host color palette already stored on the profile. The menu does not invent another. */
export function hostMenuColors(): readonly HostColor[] {
  return HOST_COLORS;
}

/**
 * The label to persist, or null when the draft must not be written.
 * Blank and whitespace-only drafts are not a rename. A draft that trims
 * back to the current label is not a write either.
 */
export function nextHostLabel(current: string, draft: string): string | null {
  const next = draft.trim();
  if (next.length === 0) return null;
  if (next === current.trim()) return null;
  return next;
}

/**
 * `removeHost` drops this device's saved host and the local replica of that
 * server id. The daemon keeps the workspaces, and other hosts are not in the
 * call. The confirmation only adds the workspace sentence when a removal
 * actually takes the workspaces with it.
 */
export const HOST_REMOVE_REMOVES_WORKSPACES = false;

export type HostRemoveMessageKey =
  | "sidebar.host.confirmations.removeMessage"
  | "sidebar.host.confirmations.removeLocalMessage";

export interface HostRemoveConfirmation {
  name: string;
  messageKey: HostRemoveMessageKey;
  /** Set only when this click also removes the host's workspaces. */
  workspaceSentenceKey: "sidebar.host.confirmations.removeWorkspaces" | null;
}

export function hostRemoveConfirmation(input: {
  name: string;
  stopsOwnedDaemon: boolean;
  removesWorkspaces: boolean;
}): HostRemoveConfirmation {
  return {
    name: input.name,
    messageKey: input.stopsOwnedDaemon
      ? "sidebar.host.confirmations.removeLocalMessage"
      : "sidebar.host.confirmations.removeMessage",
    workspaceSentenceKey: input.removesWorkspaces
      ? "sidebar.host.confirmations.removeWorkspaces"
      : null,
  };
}

/** Joins the connection sentence with the workspace sentence when that sentence exists. */
export function formatHostRemoveMessage(input: {
  connectionMessage: string;
  workspaceSentence: string | null;
}): string {
  if (!input.workspaceSentence) return input.connectionMessage;
  return `${input.connectionMessage} ${input.workspaceSentence}`;
}

/**
 * Paint for the host header title. `none` keeps the row's muted title.
 * The status dot stays the connection color; this is the stored identity color.
 */
export function hostHeaderTitleColor(color: HostColor, scheme: "light" | "dark"): string | null {
  if (color === "none") return null;
  return identityForeground(color, scheme);
}
