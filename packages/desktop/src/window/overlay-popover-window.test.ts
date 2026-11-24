import { describe, expect, it } from "vitest";

import { resolvePopoverBounds } from "./overlay-popover-window";

const WORK_AREA: Electron.Rectangle = {
  x: 0,
  y: 0,
  width: 1600,
  height: 900,
};

const ANCHOR: Electron.Rectangle = {
  x: 600,
  y: 200,
  width: 56,
  height: 56,
};

const SIZE = { width: 320, height: 220 };

function boundsFor(
  preset:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top-center"
    | "bottom-center",
) {
  return resolvePopoverBounds({
    workArea: WORK_AREA,
    anchor: ANCHOR,
    preset,
    size: SIZE,
  });
}

describe("resolvePopoverBounds", () => {
  it("opens away from the left edge when the strip is on the left", () => {
    const bounds = boundsFor("top-left");
    expect(bounds.x).toBe(ANCHOR.x + ANCHOR.width + 10);
    expect(bounds.y).toBe(ANCHOR.y + Math.round((ANCHOR.height - SIZE.height) / 2));
    expect(bounds.width).toBe(SIZE.width);
    expect(bounds.height).toBe(SIZE.height);
  });

  it("opens away from the right edge when the strip is on the right", () => {
    const bounds = boundsFor("top-right");
    expect(bounds.x).toBe(ANCHOR.x - SIZE.width - 10);
  });

  it("opens below for top-center and above for bottom-center", () => {
    const top = boundsFor("top-center");
    expect(top.y).toBe(ANCHOR.y + ANCHOR.height + 10);
    expect(top.x).toBe(ANCHOR.x + Math.round((ANCHOR.width - SIZE.width) / 2));

    const bottom = boundsFor("bottom-center");
    expect(bottom.y).toBe(0);
  });

  it("clamps the popover inside the work area", () => {
    const bounds = resolvePopoverBounds({
      workArea: WORK_AREA,
      anchor: { x: 1580, y: 870, width: 56, height: 56 },
      preset: "top-right",
      size: { width: 2000, height: 2000 },
    });
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(WORK_AREA.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(WORK_AREA.height);
    expect(bounds.width).toBeLessThanOrEqual(420);
    expect(bounds.height).toBeLessThanOrEqual(520);
  });
});
