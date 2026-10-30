/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, hosts, statuses } = vi.hoisted(() => ({
  client: {
    current: {
      getHubStatus: async () => ({ status: { state: "disconnected", hubOrigin: null } }),
      getLocalHubStatus: async (): Promise<{
        status: { installed: boolean; running: boolean; origin: string | null };
      }> => ({
        status: {
          installed: true,
          running: true,
          origin: "http://127.0.0.1:25000",
        },
      }),
    },
  },
  hosts: [{ serverId: "local", label: "This computer" }],
  statuses: new Map([["local", "online"]]),
}));

vi.mock("react-native", () => {
  const passthrough = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children);
  return {
    View: passthrough,
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("span", null, children),
    Pressable: passthrough,
    ActivityIndicator: () => React.createElement("span", { "data-testid": "spinner" }),
  };
});

vi.mock("lucide-react-native", () => ({
  Workflow: () => React.createElement("span", { "data-icon": "workflow" }),
}));

vi.mock("@/components/headers/menu-header", () => ({
  MenuHeader: ({ title }: { title?: string }) => React.createElement("header", null, title),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        "data-testid": testID,
        onClick: () => onPress?.(),
      },
      children,
    ),
}));

vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: ({
    testID,
    initialValue,
    onChangeText,
    accessibilityLabel,
  }: {
    testID?: string;
    initialValue?: string;
    onChangeText?: (value: string) => void;
    accessibilityLabel?: string;
  }) =>
    React.createElement("input", {
      "data-testid": testID,
      "aria-label": accessibilityLabel,
      defaultValue: initialValue,
      onChange: (event: { currentTarget: { value: string } }) =>
        onChangeText?.(event.currentTarget.value),
    }),
}));

vi.mock("@/automations/automations-hub-frame", () => ({
  AutomationsHubFrame: ({
    origin,
    onEnrollmentToken,
  }: {
    origin: string;
    onEnrollmentToken?: (token: string) => Promise<void>;
  }) =>
    React.createElement("div", {
      "data-testid": "automations-frame",
      "data-origin": origin,
      "data-enroll": onEnrollmentToken === undefined ? "no" : "yes",
    }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => hosts,
  useHostRuntimeConnectionStatuses: () => statuses,
  getHostRuntimeStore: () => ({
    getClient: () => client.current,
  }),
}));

import { i18n } from "@/i18n/i18next";
import { AutomationsScreen } from "./automations-screen";

let container: HTMLElement | null = null;
let root: Root | null = null;

describe("AutomationsScreen first connection", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client.current = {
      getHubStatus: async () => ({ status: { state: "disconnected", hubOrigin: null } }),
      getLocalHubStatus: async () => ({
        status: {
          installed: true,
          running: true,
          origin: "http://127.0.0.1:25000",
        },
      }),
    };
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it("asks to connect an existing Hub before opening one that is already running", async () => {
    await render();
    expect(text()).toContain("Connect Hub");
    expect(button("automations-connect-existing").textContent).toBe("Connect an existing Hub");
    expect(button("automations-install-choice").textContent).toBe("Install Hub");
    expect(container?.querySelector("[data-testid='automations-frame']")).toBeNull();
  });

  it("opens the address the operator confirms, including a remote Hub", async () => {
    await render();
    click("automations-connect-existing");
    const input = container?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("expected the Hub address field");
    }
    expect(input.defaultValue).toBe("http://127.0.0.1:25000");
    setInput(input, "https://hub.example.com/triggers");
    click("automations-origin-continue");
    expect(frameOrigin()).toBe("https://hub.example.com");
    expect(
      container?.querySelector("[data-testid='automations-frame']")?.getAttribute("data-enroll"),
    ).toBe("yes");
  });

  it("offers to start a Hub that is installed and stopped", async () => {
    client.current = {
      getHubStatus: async () => ({ status: { state: "disconnected", hubOrigin: null } }),
      getLocalHubStatus: async () => ({
        status: { installed: true, running: false, origin: null },
      }),
    };
    await render();
    expect(button("automations-install-choice").textContent).toBe("Start Hub");
    click("automations-install-choice");
    expect(text()).toContain("Hub is stopped");
    expect(container?.querySelector("[data-testid='automations-frame']")).toBeNull();
  });

  it("offers install when Hub is not on this computer", async () => {
    client.current = {
      getHubStatus: async () => ({ status: { state: "disconnected", hubOrigin: null } }),
      getLocalHubStatus: async () => ({
        status: { installed: false, running: false, origin: null },
      }),
    };
    await render();
    expect(button("automations-install-choice").textContent).toBe("Install Hub");
    click("automations-install-choice");
    expect(text()).toContain("Hub is not installed");
  });

  it("rejects an address that is not http or https", async () => {
    await render();
    click("automations-connect-existing");
    const input = container?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("expected the Hub address field");
    }
    setInput(input, "notaurl");
    click("automations-origin-continue");
    expect(text()).toContain("Enter an http or https address.");
    expect(container?.querySelector("[data-testid='automations-frame']")).toBeNull();
  });
});

/**
 * @returns Nothing.
 */
async function render(): Promise<void> {
  await act(async () => {
    root?.render(<AutomationsScreen />);
  });
}

/**
 * @param testId - Button test id
 * @returns Nothing.
 */
function click(testId: string): void {
  const node = button(testId);
  act(() => {
    node.click();
  });
}

/**
 * @param testId - Button test id
 * @returns The button
 */
function button(testId: string): HTMLButtonElement {
  const node = container?.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof HTMLButtonElement)) {
    throw new Error(`missing ${testId}`);
  }
  return node;
}

/**
 * @param input - Address field
 * @param value - What the operator typed
 * @returns Nothing.
 */
function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/**
 * @returns Visible text
 */
function text(): string {
  return container?.textContent ?? "";
}

/**
 * @returns Origin opened in the Hub frame
 */
function frameOrigin(): string | null {
  return (
    container?.querySelector("[data-testid='automations-frame']")?.getAttribute("data-origin") ??
    null
  );
}
