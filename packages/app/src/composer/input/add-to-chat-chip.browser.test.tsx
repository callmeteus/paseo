import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { serializeInlineChip, type InlineChip } from "@getpaseo/protocol/inline-chip";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { i18n } from "@/i18n/i18next";
import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { MessageInput } from "./input";
import type { TextReplacement } from "../types";

vi.mock("@/components/toast-host", () => ({
  ToastViewport: () => null,
  useToastHost: () => ({
    api: { show: () => () => {}, copied: () => {}, error: () => {} },
    state: { toasts: [] },
  }),
}));

const chip: InlineChip = {
  id: "paste:1af8685f-cdd7-4a3f-a913-7e01f05c10dc",
  kind: "paste",
  label: "[Pasted ~1 line]",
  body: "O daemon escuta em 100.66.222.98:6767 e o app já reconectou.",
};
const chipText = serializeInlineChip(chip);
const toastApi = {
  show: () => () => {},
  copied: () => {},
  error: () => {},
};
const initialReplacement: TextReplacement = { kind: "initial", key: "draft:0", text: "" };
const chipReplacement: TextReplacement = { kind: "replace", key: "draft:1", text: chipText };

function ignoreText(): void {}

function ignoreSubmit(): void {}

function Harness(props: { replacement: TextReplacement; client: QueryClient }) {
  return (
    <QueryClientProvider client={props.client}>
      <I18nextProvider i18n={i18n}>
        <ToastApiProvider api={toastApi}>
          <KeyboardActionDispatcherProvider>
            <MessageInput
              value=""
              onChangeText={ignoreText}
              onSubmit={ignoreSubmit}
              attachments={[]}
              cwd="/tmp"
              attachmentMenuItems={[]}
              client={null}
              defaultSendBehavior="queue"
              textReplacement={props.replacement}
            />
          </KeyboardActionDispatcherProvider>
        </ToastApiProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const item of mounted.splice(0)) {
    act(() => item.root.unmount());
    item.container.remove();
  }
});

describe("add to chat", () => {
  it("draws the selection as a paste chip instead of the stored record", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(<Harness client={client} replacement={initialReplacement} />);
    });

    act(() => {
      root.render(<Harness client={client} replacement={chipReplacement} />);
    });

    const chipNode = container.querySelector("[data-inline-chip]");
    expect(chipNode?.textContent).toBe("[Pasted ~1 line]");
    expect(container.textContent).not.toContain('"kind":"paste"');
  });
});
