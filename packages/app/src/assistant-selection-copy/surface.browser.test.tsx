import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import { AssistantSelectionCopySurface } from "./surface.web";

// Load translations so the action exposes its real label.
void testI18n;

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  document.getElementById("overlay-root")?.replaceChildren();
});

function mountSurface(onAddSelectionToChat: (text: string) => void): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      <AssistantSelectionCopySurface onAddSelectionToChat={onAddSelectionToChat}>
        <p data-testid="message">select these words</p>
      </AssistantSelectionCopySurface>,
    );
  });
  return container;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The surface recomputes on the next animation frame after `selectionchange`. */
async function commitSelection(range: Range): Promise<void> {
  const selection = window.getSelection();
  if (!selection) throw new Error("no selection");
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => {
    document.dispatchEvent(new Event("selectionchange"));
    await nextFrame();
    await nextFrame();
  });
}

function selectMessageText(container: HTMLElement): Promise<void> {
  const message = container.querySelector('[data-testid="message"]');
  const text = message?.firstChild;
  const content = text?.textContent;
  if (!text || !content) throw new Error("message text missing");
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, content.length);
  return commitSelection(range);
}

function findAction(): Element | null {
  return document.querySelector('[data-testid="add-selection-to-chat"]');
}

/**
 * The action hangs off a display:contents root, which generates no box. A guard that
 * measured the root instead of the selection range hid the action for every selection.
 */
describe("AssistantSelectionCopySurface", () => {
  it("offers adding the selected chat text to the composer", async () => {
    mountSurface(vi.fn());

    await selectMessageText(mounted[0]!.container);

    expect(findAction()?.textContent).toBe("Add to chat");
  });

  it("hides the action when the selected text is not inside the surface", async () => {
    mountSurface(vi.fn());
    const outside = document.createElement("p");
    outside.textContent = "unrelated text";
    document.body.appendChild(outside);

    try {
      await selectMessageText(mounted[0]!.container);
      expect(findAction()).not.toBeNull();

      const range = document.createRange();
      range.selectNodeContents(outside);
      await commitSelection(range);

      expect(findAction()).toBeNull();
    } finally {
      outside.remove();
    }
  });
});
