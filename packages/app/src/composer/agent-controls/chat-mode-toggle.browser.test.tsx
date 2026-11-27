import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ToastApi } from "@/components/toast-host";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { useSessionStore } from "@/stores/session-store";
import { ChatModeToggle } from "./chat-mode-toggle";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  useSessionStore.getState().clearSession("server");
});

function createToast(): ToastApi {
  return { error: vi.fn(), show: vi.fn(), copied: vi.fn() };
}

function renderToggle(
  input: { isOpenUIChat?: boolean; toast: ToastApi } = { toast: createToast() },
) {
  render(
    <ToastApiProvider api={input.toast}>
      <ChatModeToggle
        agentId="agent"
        serverId="server"
        isOpenUIChat={input.isOpenUIChat ?? false}
      />
    </ToastApiProvider>,
  );
}

describe("ChatModeToggle", () => {
  it("shows progress, blocks duplicate clicks, and clears after the mode switch", async () => {
    let resolve: (value: { mode: "chat"; applied: "now" }) => void = () => undefined;
    const setAgentChatMode = vi.fn(
      () =>
        new Promise<{ mode: "chat"; applied: "now" }>((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    useSessionStore.getState().initializeSession("server", {
      setAgentChatMode,
    } as unknown as DaemonClient);
    renderToggle();

    const button = screen.getByTestId("composer-chat-mode-toggle");
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(screen.getByRole("progressbar")).toBeDefined();
    fireEvent.click(button);
    expect(setAgentChatMode).toHaveBeenCalledTimes(1);
    expect(setAgentChatMode).toHaveBeenCalledWith("agent", "chat", { timeout: 30_000 });

    resolve({ mode: "chat", applied: "now" });
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("reports a failed switch and re-enables the control", async () => {
    const setAgentChatMode = vi.fn(async () => {
      throw new Error("reload failed");
    });
    const toast = { error: vi.fn() } as unknown as ToastApi;
    useSessionStore.getState().initializeSession("server", {
      setAgentChatMode,
    } as unknown as DaemonClient);
    renderToggle({ toast });

    const button = screen.getByTestId("composer-chat-mode-toggle");
    fireEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
