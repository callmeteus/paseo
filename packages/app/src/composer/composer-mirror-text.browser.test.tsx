import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { ComposerMirrorText } from "./composer-mirror-text";

const SAMPLE = "Falta\n- Formatação\n1. Aqui no composer!";
const MIRROR_STYLE = { color: "#f4f4f5", fontSize: 15, lineHeight: 21 };
const mounted: { root: Root; container: HTMLDivElement }[] = [];

function mount(text: string): HTMLDivElement {
  const container = document.createElement("div");
  container.style.background = "#171717";
  container.style.padding = "16px";
  container.style.width = "280px";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ComposerMirrorText
        text={text}
        skillNames={[]}
        style={MIRROR_STYLE}
        testID="composer-mirror-text"
      />,
    );
  });
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const item of mounted.splice(0)) {
    act(() => item.root.unmount());
    item.container.remove();
  }
});

describe("composer list formatting", () => {
  it("draws a bullet on the list marker and mutes the ordered marker", async () => {
    const container = mount(SAMPLE);
    const bullet = [...container.querySelectorAll("span")].find((node) => node.textContent === "•");
    const hyphen = [...container.querySelectorAll("span")].find((node) => node.textContent === "-");
    const number = [...container.querySelectorAll("span")].find(
      (node) => node.textContent === "1.",
    );
    expect(bullet).toBeTruthy();
    expect(hyphen).toBeTruthy();
    expect(number).toBeTruthy();
    const bulletStyle = window.getComputedStyle(bullet!);
    const hyphenStyle = window.getComputedStyle(hyphen!);
    const numberStyle = window.getComputedStyle(number!);
    expect(bulletStyle.position).toBe("absolute");
    expect(bulletStyle.color).toBe("rgb(102, 102, 102)");
    expect(hyphenStyle.color).toBe("rgba(0, 0, 0, 0)");
    expect(numberStyle.color).toBe("rgb(102, 102, 102)");
    const bulletBox = bullet!.getBoundingClientRect();
    const hyphenBox = hyphen!.getBoundingClientRect();
    expect(Math.abs(bulletBox.left - hyphenBox.left)).toBeLessThan(2);
    expect(Math.abs(bulletBox.top - hyphenBox.top)).toBeLessThan(4);
    await page.screenshot({
      element: container,
      path: "/tmp/composer-mirror-text.png",
    });
  });

  it("paints closed backticks as code and hides the marks", () => {
    const container = mount("Também precisa suportar `backticks`");
    const code = [...container.querySelectorAll("span")].find(
      (node) => node.textContent === "`backticks`",
    );
    expect(code).toBeTruthy();
    const codeStyle = window.getComputedStyle(code!);
    expect(codeStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    const mark = [...code!.querySelectorAll("span")].find((node) => node.textContent === "`");
    expect(mark).toBeTruthy();
    expect(window.getComputedStyle(mark!).color).toBe("rgba(0, 0, 0, 0)");
  });
});
