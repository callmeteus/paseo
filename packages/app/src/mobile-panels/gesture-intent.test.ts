import { describe, expect, it } from "vitest";

import { isOutsideOpenGestureEdge, resolveMobilePanelGestureIntent } from "./gesture-intent";

describe("mobile panel gesture intent", () => {
  it("blocks both panel-opening directions while the active surface owns horizontal dragging", () => {
    expect([
      resolveMobilePanelGestureIntent({
        deltaX: 40,
        deltaY: 2,
        direction: 1,
        openGesturesBlocked: true,
      }),
      resolveMobilePanelGestureIntent({
        deltaX: -40,
        deltaY: 2,
        direction: -1,
        openGesturesBlocked: true,
      }),
    ]).toEqual(["fail", "fail"]);
  });

  it("keeps ordinary horizontal panel gestures available when unblocked", () => {
    expect([
      resolveMobilePanelGestureIntent({
        deltaX: 40,
        deltaY: 2,
        direction: 1,
        openGesturesBlocked: false,
      }),
      resolveMobilePanelGestureIntent({
        deltaX: -40,
        deltaY: 2,
        direction: -1,
        openGesturesBlocked: false,
      }),
    ]).toEqual(["activate", "activate"]);
  });
});

describe("mobile panel open gesture edge gate", () => {
  const edgeWidth = 32;

  it("keeps the left-edge gate for a mouse on the web so paragraph selection still works", () => {
    expect(
      isOutsideOpenGestureEdge({
        isWeb: true,
        isTouchPointer: false,
        touchStartX: 200,
        edgeWidth,
      }),
    ).toBe(true);
    expect(
      isOutsideOpenGestureEdge({
        isWeb: true,
        isTouchPointer: false,
        touchStartX: 10,
        edgeWidth,
      }),
    ).toBe(false);
  });

  it("lets a finger start the swipe anywhere in the chat", () => {
    expect(
      isOutsideOpenGestureEdge({
        isWeb: true,
        isTouchPointer: true,
        touchStartX: 200,
        edgeWidth,
      }),
    ).toBe(false);
  });

  it("never gates native, which has no edge restriction to begin with", () => {
    expect(
      isOutsideOpenGestureEdge({
        isWeb: false,
        isTouchPointer: false,
        touchStartX: 400,
        edgeWidth,
      }),
    ).toBe(false);
  });
});
