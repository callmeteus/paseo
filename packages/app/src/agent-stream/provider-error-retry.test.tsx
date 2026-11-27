import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { ProviderErrorRetry } from "./provider-error-retry";

const mocks = vi.hoisted(() => ({
  sendAgentMessage: vi.fn(),
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({ sendAgentMessage: mocks.sendAgentMessage }),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const serverId = "host-1";
const agentId = "agent-1";
const draftKey = buildDraftStoreKey({ serverId, agentId });

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("MouseEvent", dom.window.MouseEvent);
  vi.stubGlobal("navigator", dom.window.navigator);
  useDraftStore.setState({ drafts: {}, createModalDraft: null });
  mocks.sendAgentMessage.mockReset();
  mocks.sendAgentMessage.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function mount() {
  act(() => root?.render(<ProviderErrorRetry serverId={serverId} agentId={agentId} />));
}

describe("ProviderErrorRetry", () => {
  it("stays visible with a fallback prompt when the draft was not restored", () => {
    act(() =>
      root?.render(
        <ProviderErrorRetry serverId={serverId} agentId={agentId} fallbackText="faz deploy" />,
      ),
    );

    const button = container.querySelector("[data-testid='provider-error-retry']");
    expect(button).not.toBeNull();
    expect(button?.hasAttribute("disabled")).toBe(false);
  });

  it("is disabled when neither the draft nor a fallback prompt exists", () => {
    mount();
    const button = container.querySelector("[data-testid='provider-error-retry']");
    expect(button).not.toBeNull();
    expect(button?.hasAttribute("disabled")).toBe(true);
  });

  it("resends the fallback prompt when the draft was not restored", async () => {
    act(() =>
      root?.render(
        <ProviderErrorRetry serverId={serverId} agentId={agentId} fallbackText="faz deploy" />,
      ),
    );

    const button = container.querySelector("[data-testid='provider-error-retry']");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.sendAgentMessage).toHaveBeenCalledWith(
      agentId,
      "faz deploy",
      expect.objectContaining({ messageId: expect.any(String) }),
    );
  });

  it("prefers the restored draft over the transcript fallback", async () => {
    useDraftStore
      .getState()
      .saveDraftInput({ draftKey, draft: { text: "texto do draft", attachments: [] } });
    act(() =>
      root?.render(
        <ProviderErrorRetry serverId={serverId} agentId={agentId} fallbackText="texto antigo" />,
      ),
    );

    const button = container.querySelector("[data-testid='provider-error-retry']");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.sendAgentMessage).toHaveBeenCalledWith(
      agentId,
      "texto do draft",
      expect.objectContaining({ messageId: expect.any(String) }),
    );
  });

  it("resends the restored prompt and clears the draft", async () => {
    useDraftStore
      .getState()
      .saveDraftInput({ draftKey, draft: { text: "faz deploy", attachments: [] } });
    mount();

    const button = container.querySelector("[data-testid='provider-error-retry']");
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.sendAgentMessage).toHaveBeenCalledWith(
      agentId,
      "faz deploy",
      expect.objectContaining({ messageId: expect.any(String) }),
    );
    expect(useDraftStore.getState().getDraftInput(draftKey)).toBeUndefined();
  });
});
