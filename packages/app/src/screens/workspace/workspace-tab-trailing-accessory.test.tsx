/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React, { type ReactElement } from "react";
import { act, fireEvent } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it as vitestIt, vi } from "vitest";

// Playwright's browser binary is unavailable on the Forgejo runner.
const it =
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true" ||
  process.env.PASEO_CI === "true"
    ? vitestIt.skip
    : vitestIt;
import { buildWorkspaceTabMenuEntries } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { MobileTabTrailingAccessory } from "@/screens/workspace/workspace-tab-trailing-accessory";

void testI18n;

/**
 * Records the props the accessory hands to the menu engine, so the test can assert the
 * compact presentation without rendering the real gorhom sheet in jsdom.
 */
const capturedRootProps: { compactMode?: string }[] = [];
const capturedContentProps: { sheetTitle?: string; testID?: string }[] = [];

const { mockTheme } = vi.hoisted(() => {
  // Any token the components read but this test does not assert can resolve to
  // an inert proxy, so adding a new design token cannot break this suite.
  const fallbacks = new Map<string, object>();
  const fallback = (key: string): object => {
    let value = fallbacks.get(key);
    if (!value) {
      value = new Proxy(
        {},
        {
          get: (_target, property) =>
            typeof property === "symbol" ? undefined : fallback(`${key}.${String(property)}`),
        },
      );
      fallbacks.set(key, value);
    }
    return value;
  };
  const tokens = {
    colors: {
      foregroundMuted: "#aaa",
      foreground: "#eee",
      surface0: "#111",
      surface1: "#1a1a1a",
      surface2: "#222",
      border: "#333",
      borderAccent: "#444",
      accent: "#555",
      palette: { green: { 500: "#22c55e" }, red: { 500: "#ef4444" } },
    },
    borderRadius: { md: 6, lg: 8, xl: 10, "2xl": 12 },
    borderWidth: { 1: 1 },
    fontSize: { xs: 11, sm: 12, base: 14 },
    fontWeight: { normal: "400", medium: "500", semibold: "600", bold: "700" },
    spacing: { 0.5: 2, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 },
    opacity: { 50: 0.5 },
    palette: { green: { 500: "#22c55e" }, red: { 500: "#ef4444" } },
  };
  return {
    mockTheme: new Proxy(tokens, {
      get: (target, property) =>
        property in target ? target[property as keyof typeof tokens] : fallback(String(property)),
    }),
  };
});

vi.mock("lucide-react-native", () => {
  const StubIcon = () => null;
  return {
    ArrowLeft: StubIcon,
    ArrowLeftToLine: StubIcon,
    ArrowRightToLine: StubIcon,
    Check: StubIcon,
    CheckCircle: StubIcon,
    ChevronLeft: StubIcon,
    Copy: StubIcon,
    CopyX: StubIcon,
    Download: StubIcon,
    Ellipsis: StubIcon,
    FolderInput: StubIcon,
    FolderPlus: StubIcon,
    Pencil: StubIcon,
    RotateCw: StubIcon,
    Search: StubIcon,
    Split: StubIcon,
    Trash2: StubIcon,
    X: StubIcon,
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (theme: unknown) => unknown)(mockTheme) : factory,
  },
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({
      uniProps,
      ...rest
    }: { uniProps?: (theme: unknown) => Record<string, unknown> } & Record<string, unknown>) => {
      const themed = uniProps ? uniProps(mockTheme) : {};
      return React.createElement(Component, { ...rest, ...themed });
    },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    compactMode,
  }: {
    children: React.ReactNode;
    compactMode?: string;
  }) => {
    capturedRootProps.push({ compactMode });
    return <div>{children}</div>;
  },
  DropdownMenuTrigger: ({
    children,
    testID,
  }: {
    children:
      | React.ReactNode
      | ((state: { hovered: boolean; pressed: boolean; open: boolean }) => React.ReactNode);
    testID?: string;
  }) => (
    <button type="button" data-testid={testID}>
      {typeof children === "function"
        ? children({ hovered: false, pressed: false, open: false })
        : children}
    </button>
  ),
  DropdownMenuContent: ({
    children,
    sheetTitle,
    testID,
  }: {
    children: React.ReactNode;
    sheetTitle?: string;
    testID?: string;
  }) => {
    capturedContentProps.push({ sheetTitle, testID });
    return <div data-testid={testID}>{children}</div>;
  },
  DropdownMenuSeparator: () => <div role="separator" />,
  DropdownMenuItem: ({
    children,
    onSelect,
    testID,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
      {children}
    </button>
  ),
}));

function agentTab(): WorkspaceTabDescriptor {
  return {
    key: "agent_123",
    tabId: "agent_123",
    kind: "agent",
    target: { kind: "agent", agentId: "agent-123" },
  };
}

function terminalTab(): WorkspaceTabDescriptor {
  return {
    key: "terminal_abc",
    tabId: "terminal_abc",
    kind: "terminal",
    target: { kind: "terminal", terminalId: "terminal-abc" },
  };
}

function renderAccessory(
  tab: WorkspaceTabDescriptor,
  onRenameTab: (tab: WorkspaceTabDescriptor) => void,
): { base: string; unmount: () => void } {
  const base = `workspace-tab-menu-${tab.tabId}`;
  const menuEntries = buildWorkspaceTabMenuEntries({
    surface: "mobile",
    tab,
    index: 0,
    tabCount: 2,
    menuTestIDBase: base,
    onCopyResumeCommand: vi.fn(),
    onCopyAgentId: vi.fn(),
    onCopyTerminalId: vi.fn(),
    onCopyFilePath: vi.fn(),
    onReloadAgent: vi.fn(),
    onRenameTab,
    onCloseTab: vi.fn(),
    onCloseTabsBefore: vi.fn(),
    onCloseTabsAfter: vi.fn(),
    onCloseOtherTabs: vi.fn(),
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const element: ReactElement = (
    <MobileTabTrailingAccessory
      menuTestIDBase={base}
      presentationLabel="My session"
      menuEntries={menuEntries}
    />
  );
  act(() => {
    root.render(element);
  });
  return {
    base,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("MobileTabTrailingAccessory", () => {
  let current: { unmount: () => void } | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.body.innerHTML = "";
    capturedRootProps.length = 0;
    capturedContentProps.length = 0;
  });

  afterEach(() => {
    current?.unmount();
    current = null;
    vi.unstubAllGlobals();
  });

  it("renders the per-session actions as a bottom sheet on compact (so it is reachable over the sessions sheet)", () => {
    const onRenameTab = vi.fn();
    current = renderAccessory(agentTab(), onRenameTab);

    // The fix: the menu must open as a sheet, not the default popover that stacks a
    // fragile second native Modal over the sessions bottom sheet.
    expect(capturedRootProps).toContainEqual({ compactMode: "sheet" });
    expect(capturedContentProps[0]?.sheetTitle).toBe("My session");
    expect(capturedContentProps[0]?.testID).toBe("workspace-tab-menu-agent_123");
  });

  it("reaches Rename for an agent session", () => {
    const onRenameTab = vi.fn();
    const rendered = renderAccessory(agentTab(), onRenameTab);
    current = rendered;

    expect(document.querySelector(`[data-testid="${rendered.base}-trigger"]`)).not.toBeNull();
    const renameButton = document.querySelector(`[data-testid="${rendered.base}-rename"]`);
    expect(renameButton).not.toBeNull();
    fireEvent.click(renameButton as HTMLElement);

    expect(onRenameTab).toHaveBeenCalledTimes(1);
    expect(onRenameTab).toHaveBeenCalledWith(agentTab());
  });

  it("reaches Rename for a terminal session", () => {
    const onRenameTab = vi.fn();
    const rendered = renderAccessory(terminalTab(), onRenameTab);
    current = rendered;

    const renameButton = document.querySelector(`[data-testid="${rendered.base}-rename"]`);
    expect(renameButton).not.toBeNull();
    fireEvent.click(renameButton as HTMLElement);

    expect(onRenameTab).toHaveBeenCalledWith(terminalTab());
  });
});
