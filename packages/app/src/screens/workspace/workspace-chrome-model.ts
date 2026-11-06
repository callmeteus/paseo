/**
 * Desktop workspace chrome: which band owns each control, which pane's tab line
 * carries Commit and the explorer toggle, and which existing views the right rail opens.
 * Pure on purpose so a unit test can pin the placement without rendering the UI.
 */

export type WorkspaceChromeControl = "ide" | "commit" | "explorer-sidebar";

export type WorkspaceChromeBand = "header" | "tab-line";

export type WorkspaceTabLineHost = "main" | "explorer" | "sheet";

export type WorkspaceChromePaneNode =
  | { kind: "pane"; id: string; hidden?: boolean }
  | {
      kind: "group";
      direction: "horizontal" | "vertical";
      children: readonly WorkspaceChromePaneNode[];
    };

export const ACTIVITY_RAIL_ENTRY_ORDER = ["changes", "browser", "terminal", "files"] as const;

export type ActivityRailEntryId = (typeof ACTIVITY_RAIL_ENTRY_ORDER)[number];

export interface ActivityRailAvailability {
  changes: boolean;
  browser: boolean;
  terminal: boolean;
  files: boolean;
}

export interface ActivityRailTabRef {
  tabId: string;
  kind: string;
}

export type ActivityRailActivation = { kind: "focus"; tabId: string } | { kind: "open" };

export type ActivityRailPresentation = "rail" | "canvas" | "hidden";

/**
 * The conversation lives in the middle without occupying it. A file, terminal, browser,
 * diff or any other editor tab does, and the large grid gives that space back.
 */
const MIDDLE_CONVERSATION_TAB_KINDS = new Set(["agent", "draft", "new_tab", "provider_subagent"]);

const ACTIVITY_RAIL_TAB_KINDS: Record<ActivityRailEntryId, readonly string[]> = {
  // Changes is the explorer changes tree. The separate diff tab is a different view.
  changes: ["changes_tree"],
  browser: ["browser"],
  terminal: ["terminal"],
  files: ["files"],
};

/**
 * The IDE opener stays on the title row. Commit and the explorer toggle move together
 * onto the tab line, so the sidebar control sits beside Commit the way Cursor puts it
 * on the tab strip.
 */
export function resolveWorkspaceChromeBand(control: WorkspaceChromeControl): WorkspaceChromeBand {
  if (control === "ide") return "header";
  return "tab-line";
}

/**
 * The tab line under the title is one row when the workspace has no splits, and one row
 * per pane when it does. Commit and the explorer toggle belong on a single row: the
 * top-right pane, or the maximized pane when one pane covers the rest.
 */
export function resolveWorkspaceChromePaneId(input: {
  root: WorkspaceChromePaneNode | null;
  maximizedPaneId: string | null;
}): string | null {
  if (!input.root) return null;
  if (input.maximizedPaneId && chromeTreeContainsPane(input.root, input.maximizedPaneId)) {
    return input.maximizedPaneId;
  }
  return rightmostVisiblePaneId(input.root);
}

export function tabLineHostsWorkspaceChrome(input: {
  host: WorkspaceTabLineHost;
  paneId?: string | null;
  chromePaneId: string | null;
  soleMainRow: boolean;
}): boolean {
  if (input.host !== "main") return false;
  if (input.soleMainRow) return true;
  return input.chromePaneId !== null && input.paneId === input.chromePaneId;
}

/**
 * Kinds of the tabs in main panes. The explorer dock is not the middle, so its files
 * and changes tree do not count as an editor tab sitting beside the chat.
 */
export function workspaceMiddleTabKinds(input: {
  panes: readonly { id: string; tabIds: readonly string[] }[];
  explorerPaneId: string | null;
  kindByTabId: ReadonlyMap<string, string>;
}): string[] {
  const kinds: string[] = [];
  for (const pane of input.panes) {
    if (input.explorerPaneId !== null && pane.id === input.explorerPaneId) continue;
    for (const tabId of pane.tabIds) {
      const kind = input.kindByTabId.get(tabId);
      if (kind) kinds.push(kind);
    }
  }
  return kinds;
}

export function workspaceMiddleHasEditorTab(kinds: readonly string[]): boolean {
  return kinds.some((kind) => !MIDDLE_CONVERSATION_TAB_KINDS.has(kind));
}

const SIDEBAR_CONVERSATION_TAB_KINDS = new Set(["agent", "draft", "provider_subagent"]);

/**
 * The sidebar is empty when it has no conversation. A new-tab launcher is still empty.
 * The large grid is that empty state, not a pane beside a chat.
 */
export function workspaceSidebarIsEmpty(kinds: readonly string[]): boolean {
  return !kinds.some((kind) => SIDEBAR_CONVERSATION_TAB_KINDS.has(kind));
}

/**
 * The side column only exists while the left sidebar is closed and no changes, file,
 * terminal or browser is open. The large grid is the empty sidebar. A chat with the
 * sidebar open does not grow a second column beside it.
 */
export function resolveActivityRailPresentation(input: {
  enabled: boolean;
  sidebarOpen: boolean;
  sidebarEmpty: boolean;
  middleHasEditorTab: boolean;
  entryCount: number;
}): ActivityRailPresentation {
  if (!input.enabled || input.entryCount === 0) return "hidden";
  if (input.middleHasEditorTab) return "hidden";
  if (!input.sidebarOpen) return "rail";
  if (input.sidebarEmpty) return "canvas";
  return "hidden";
}

/** Drops a rail entry whose view the product cannot open. Order matches the Cursor rail. */
export function resolveActivityRailEntries(
  availability: ActivityRailAvailability,
): ActivityRailEntryId[] {
  return ACTIVITY_RAIL_ENTRY_ORDER.filter((entry) => availability[entry]);
}

/**
 * An entry focuses a tab the workspace already has. It asks the caller to open the
 * existing view only when that tab is absent, so a second terminal or browser is not created.
 */
export function resolveActivityRailActivation(input: {
  entry: ActivityRailEntryId;
  tabs: readonly ActivityRailTabRef[];
}): ActivityRailActivation {
  const kinds = ACTIVITY_RAIL_TAB_KINDS[input.entry];
  const existing = input.tabs.find((tab) => kinds.includes(tab.kind));
  if (existing) return { kind: "focus", tabId: existing.tabId };
  return { kind: "open" };
}

export function activityRailEntryForTabKind(
  kind: string | null | undefined,
): ActivityRailEntryId | null {
  switch (kind) {
    case "changes_tree":
      return "changes";
    case "browser":
      return "browser";
    case "terminal":
      return "terminal";
    case "files":
      return "files";
    default:
      return null;
  }
}

/** The focused view wins. Otherwise the explorer's current view, when that dock is open. */
export function resolveActiveActivityRailEntry(input: {
  focusedKind: string | null;
  explorerKind: string | null;
}): ActivityRailEntryId | null {
  return (
    activityRailEntryForTabKind(input.focusedKind) ??
    activityRailEntryForTabKind(input.explorerKind)
  );
}

/**
 * The rail's caption is the repo the session already has, then the workspace name.
 * An empty session contributes nothing: the caption is never invented.
 */
export function resolveActivityRailContextLabel(input: {
  projectName?: string | null;
  workspaceName?: string | null;
}): string | null {
  return trimLabel(input.projectName) ?? trimLabel(input.workspaceName);
}

function trimLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function chromeTreeContainsPane(node: WorkspaceChromePaneNode, paneId: string): boolean {
  if (node.kind === "pane") return node.id === paneId;
  return node.children.some((child) => chromeTreeContainsPane(child, paneId));
}

function rightmostVisiblePaneId(node: WorkspaceChromePaneNode): string | null {
  if (node.kind === "pane") return node.hidden ? null : node.id;
  // A horizontal row's right edge is the last child. A vertical stack's top edge is the first.
  const ordered = node.direction === "horizontal" ? [...node.children].toReversed() : node.children;
  for (const child of ordered) {
    const paneId = rightmostVisiblePaneId(child);
    if (paneId) return paneId;
  }
  return null;
}
