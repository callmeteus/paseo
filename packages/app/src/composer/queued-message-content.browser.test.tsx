import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { serializeInlineChip, type InlineChip } from "@getpaseo/protocol/inline-chip";
import { QueuedMessageContent } from "./queued-message-content";

const chip: InlineChip = {
  id: "paste:queue-1",
  kind: "paste",
  label: "[Colado ~3 linhas]",
  body: "one\ntwo\nthree",
};
const TEXT = `Veja ${serializeInlineChip(chip)} e depois:\n- item\n\`code\``;
const QUEUE_STYLE = { color: "#f4f4f5", fontSize: 14 };
const NO_SKILLS: string[] = [];
const NO_ATTACHMENTS: never[] = [];
const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const item of mounted.splice(0)) {
    act(() => item.root.unmount());
    item.container.remove();
  }
});

function mount() {
  const container = document.createElement("div");
  container.style.width = "420px";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueuedMessageContent
        text={TEXT}
        attachments={NO_ATTACHMENTS}
        skillNames={NO_SKILLS}
        style={QUEUE_STYLE}
      />,
    );
  });
  mounted.push({ root, container });
  return container;
}

describe("queued message content", () => {
  it("renders the chip as a hoverable span, not the raw marker", () => {
    const container = mount();
    const chipNode = container.querySelector("[data-testid='queued-inline-chip']");
    expect(chipNode?.textContent).toBe("[Colado ~3 linhas]");
    expect(container.textContent).not.toContain("\u001E");
  });

  it("keeps the composer list and inline code formatting", () => {
    const container = mount();
    expect([...container.querySelectorAll("span")].some((node) => node.textContent === "•")).toBe(
      true,
    );
    expect(
      [...container.querySelectorAll("span")].some((node) => node.textContent === "`code`"),
    ).toBe(true);
  });
});
