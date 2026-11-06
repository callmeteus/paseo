import { describe, expect, it } from "vitest";
import {
  resolveActiveActivityRailEntry,
  resolveActivityRailActivation,
  resolveActivityRailContextLabel,
  resolveActivityRailEntries,
  resolveWorkspaceChromeBand,
  resolveWorkspaceChromePaneId,
  tabLineHostsWorkspaceChrome,
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
