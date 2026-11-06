import { describe, expect, it } from "vitest";
import {
  resolveActiveActivityRailEntry,
  resolveActivityRailActivation,
  resolveActivityRailContextLabel,
  resolveActivityRailEntries,
  resolveActivityRailPresentation,
  resolveWorkspaceChromeBand,
  resolveWorkspaceChromePaneId,
  tabLineHostsWorkspaceChrome,
  workspaceMiddleHasEditorTab,
  workspaceMiddleTabKinds,
  workspaceSidebarIsEmpty,
  type WorkspaceChromePaneNode,
} from "./workspace-chrome-model";

const horizontal: WorkspaceChromePaneNode = {
  kind: "group",
  direction: "horizontal",
  children: [
    { kind: "pane", id: "left" },
    { kind: "pane", id: "right" },
  ],
};

describe("resolveWorkspaceChromeBand", () => {
  it("keeps the IDE opener on the title row and moves Commit with the sidebar toggle", () => {
    expect(resolveWorkspaceChromeBand("ide")).toBe("header");
    expect(resolveWorkspaceChromeBand("commit")).toBe("tab-line");
    expect(resolveWorkspaceChromeBand("explorer-sidebar")).toBe("tab-line");
  });
});

describe("tabLineHostsWorkspaceChrome", () => {
  it("gives the sole main tab line the chrome and keeps it off the explorer strip", () => {
    expect(
      tabLineHostsWorkspaceChrome({
        host: "main",
        paneId: "only",
        chromePaneId: null,
        soleMainRow: true,
      }),
    ).toBe(true);
    expect(
      tabLineHostsWorkspaceChrome({
        host: "explorer",
        paneId: "explorer",
        chromePaneId: null,
        soleMainRow: true,
      }),
    ).toBe(false);
  });

  it("puts the chrome on the chosen pane once the workspace is split", () => {
    expect(
      tabLineHostsWorkspaceChrome({
        host: "main",
        paneId: "right",
        chromePaneId: "right",
        soleMainRow: false,
      }),
    ).toBe(true);
    expect(
      tabLineHostsWorkspaceChrome({
        host: "main",
        paneId: "left",
        chromePaneId: "right",
        soleMainRow: false,
      }),
    ).toBe(false);
    expect(
      tabLineHostsWorkspaceChrome({
        host: "main",
        paneId: "right",
        chromePaneId: null,
        soleMainRow: false,
      }),
    ).toBe(false);
  });
});

describe("resolveWorkspaceChromePaneId", () => {
  it("uses the only pane, the right edge of a row, and the top-right of a stack", () => {
    expect(
      resolveWorkspaceChromePaneId({ root: { kind: "pane", id: "only" }, maximizedPaneId: null }),
    ).toBe("only");
    expect(resolveWorkspaceChromePaneId({ root: horizontal, maximizedPaneId: null })).toBe("right");
    const stacked: WorkspaceChromePaneNode = {
      kind: "group",
      direction: "vertical",
      children: [
        horizontal,
        {
          kind: "group",
          direction: "horizontal",
          children: [
            { kind: "pane", id: "bottom-left" },
            { kind: "pane", id: "bottom-right" },
          ],
        },
      ],
    };
    expect(resolveWorkspaceChromePaneId({ root: stacked, maximizedPaneId: null })).toBe("right");
  });

  it("skips a hidden pane and follows the maximized pane", () => {
    const hiddenRight: WorkspaceChromePaneNode = {
      kind: "group",
      direction: "horizontal",
      children: [
        { kind: "pane", id: "left" },
        { kind: "pane", id: "right", hidden: true },
      ],
    };
    expect(resolveWorkspaceChromePaneId({ root: hiddenRight, maximizedPaneId: null })).toBe("left");
    expect(resolveWorkspaceChromePaneId({ root: horizontal, maximizedPaneId: "left" })).toBe(
      "left",
    );
    expect(resolveWorkspaceChromePaneId({ root: null, maximizedPaneId: "left" })).toBeNull();
  });
});

describe("resolveActivityRailEntries", () => {
  it("keeps Changes, Browser, Terminal and Files in rail order when each view exists", () => {
    expect(
      resolveActivityRailEntries({
        changes: true,
        browser: true,
        terminal: true,
        files: true,
      }),
    ).toEqual(["changes", "browser", "terminal", "files"]);
  });

  it("omits a view the product cannot open", () => {
    expect(
      resolveActivityRailEntries({
        changes: false,
        browser: false,
        terminal: true,
        files: true,
      }),
    ).toEqual(["terminal", "files"]);
    expect(
      resolveActivityRailEntries({
        changes: false,
        browser: false,
        terminal: false,
        files: false,
      }),
    ).toEqual([]);
  });
});

describe("resolveActivityRailActivation", () => {
  const tabs = [
    { tabId: "term-1", kind: "terminal" },
    { tabId: "term-2", kind: "terminal" },
    { tabId: "changes", kind: "changes_tree" },
    { tabId: "diff", kind: "working_diff" },
    { tabId: "files", kind: "files" },
  ];

  it("focuses the existing view instead of opening another", () => {
    expect(resolveActivityRailActivation({ entry: "terminal", tabs })).toEqual({
      kind: "focus",
      tabId: "term-1",
    });
    expect(resolveActivityRailActivation({ entry: "changes", tabs })).toEqual({
      kind: "focus",
      tabId: "changes",
    });
    expect(resolveActivityRailActivation({ entry: "files", tabs })).toEqual({
      kind: "focus",
      tabId: "files",
    });
  });

  it("asks to open only when that view is absent", () => {
    expect(resolveActivityRailActivation({ entry: "browser", tabs })).toEqual({ kind: "open" });
    expect(
      resolveActivityRailActivation({
        entry: "changes",
        tabs: [{ tabId: "diff", kind: "working_diff" }],
      }),
    ).toEqual({ kind: "open" });
  });
});

describe("resolveActivityRailContextLabel", () => {
  it("uses the repo the session already has, then the workspace name", () => {
    expect(
      resolveActivityRailContextLabel({
        projectName: "luckymaker-workspace",
        workspaceName: "Servidor Local",
      }),
    ).toBe("luckymaker-workspace");
    expect(
      resolveActivityRailContextLabel({ projectName: "  ", workspaceName: "Servidor Local" }),
    ).toBe("Servidor Local");
    expect(resolveActivityRailContextLabel({ projectName: "", workspaceName: " " })).toBeNull();
    expect(resolveActivityRailContextLabel({})).toBeNull();
  });
});

describe("workspaceMiddleTabKinds", () => {
  const kindByTabId = new Map([
    ["agent", "agent"],
    ["file", "file"],
    ["explorer-files", "files"],
    ["explorer-changes", "changes_tree"],
  ]);

  it("ignores the explorer dock and keeps the main panes", () => {
    expect(
      workspaceMiddleTabKinds({
        panes: [
          { id: "main", tabIds: ["agent", "file"] },
          { id: "explorer", tabIds: ["explorer-files", "explorer-changes"] },
        ],
        explorerPaneId: "explorer",
        kindByTabId,
      }),
    ).toEqual(["agent", "file"]);
  });
});

describe("workspaceMiddleHasEditorTab", () => {
  it("treats the conversation as an empty middle", () => {
    expect(workspaceMiddleHasEditorTab([])).toBe(false);
    expect(workspaceMiddleHasEditorTab(["agent", "draft", "new_tab", "provider_subagent"])).toBe(
      false,
    );
  });

  it("treats a file, terminal or diff as occupying the middle", () => {
    expect(workspaceMiddleHasEditorTab(["agent", "file"])).toBe(true);
    expect(workspaceMiddleHasEditorTab(["terminal"])).toBe(true);
    expect(workspaceMiddleHasEditorTab(["working_diff"])).toBe(true);
  });
});

describe("workspaceSidebarIsEmpty", () => {
  it("is empty without a conversation, including a bare new-tab launcher", () => {
    expect(workspaceSidebarIsEmpty([])).toBe(true);
    expect(workspaceSidebarIsEmpty(["new_tab"])).toBe(true);
  });

  it("is not empty once a chat is open", () => {
    expect(workspaceSidebarIsEmpty(["agent"])).toBe(false);
    expect(workspaceSidebarIsEmpty(["draft", "new_tab"])).toBe(false);
    expect(workspaceSidebarIsEmpty(["provider_subagent"])).toBe(false);
  });
});

describe("resolveActivityRailPresentation", () => {
  const available = {
    enabled: true,
    entryCount: 4,
    middleHasEditorTab: false,
    sidebarOpen: true,
    sidebarEmpty: true,
  };

  it("uses the side column only while the left sidebar is closed and no view is open", () => {
    expect(resolveActivityRailPresentation({ ...available, sidebarOpen: false })).toBe("rail");
  });

  it("uses the large grid only when the open sidebar is empty", () => {
    expect(resolveActivityRailPresentation(available)).toBe("canvas");
  });

  it("hides the column when the sidebar is open on a chat", () => {
    expect(resolveActivityRailPresentation({ ...available, sidebarEmpty: false })).toBe("hidden");
  });

  it("hides both when an editor tab is open, or when the chrome itself is off", () => {
    expect(resolveActivityRailPresentation({ ...available, middleHasEditorTab: true })).toBe(
      "hidden",
    );
    expect(
      resolveActivityRailPresentation({
        ...available,
        sidebarOpen: false,
        middleHasEditorTab: true,
      }),
    ).toBe("hidden");
    expect(
      resolveActivityRailPresentation({
        ...available,
        sidebarEmpty: false,
        middleHasEditorTab: true,
      }),
    ).toBe("hidden");
    expect(resolveActivityRailPresentation({ ...available, enabled: false })).toBe("hidden");
    expect(resolveActivityRailPresentation({ ...available, entryCount: 0 })).toBe("hidden");
  });
});

describe("resolveActiveActivityRailEntry", () => {
  it("marks the focused view, and the open explorer view when focus is elsewhere", () => {
    expect(resolveActiveActivityRailEntry({ focusedKind: "browser", explorerKind: "files" })).toBe(
      "browser",
    );
    expect(resolveActiveActivityRailEntry({ focusedKind: "agent", explorerKind: "files" })).toBe(
      "files",
    );
    expect(resolveActiveActivityRailEntry({ focusedKind: "agent", explorerKind: null })).toBeNull();
  });
});
