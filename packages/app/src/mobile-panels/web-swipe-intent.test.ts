import { describe, expect, it } from "vitest";

import { nextWebSwipePhase, shouldCompleteWebSwipe } from "./web-swipe-intent";

describe("web swipe phase", () => {
  it("activates once the drag is clearly horizontal and rightward", () => {
    expect(nextWebSwipePhase({ phase: "tracking", deltaX: 20, deltaY: 3, blocked: false })).toBe(
      "active",
    );
  });

  it("keeps waiting while the intent is still ambiguous", () => {
    expect(nextWebSwipePhase({ phase: "tracking", deltaX: 6, deltaY: 2, blocked: false })).toBe(
      "tracking",
    );
  });

  it("cancels when the reader is scrolling the transcript", () => {
    expect(nextWebSwipePhase({ phase: "tracking", deltaX: 18, deltaY: 40, blocked: false })).toBe(
      "cancelled",
    );
  });

  it("cancels leftward travel so it stays with the explorer gesture", () => {
    expect(nextWebSwipePhase({ phase: "tracking", deltaX: -20, deltaY: 2, blocked: false })).toBe(
      "cancelled",
    );
  });

  it("cancels when a horizontal scroller or focused surface owns the drag", () => {
    expect(nextWebSwipePhase({ phase: "tracking", deltaX: 30, deltaY: 2, blocked: true })).toBe(
      "cancelled",
    );
  });

  it("never leaves a cancelled swipe", () => {
    expect(nextWebSwipePhase({ phase: "cancelled", deltaX: 90, deltaY: 1, blocked: false })).toBe(
      "cancelled",
    );
  });
});

describe("web swipe completion", () => {
  it("opens past a third of the screen or on a fast flick", () => {
    expect(shouldCompleteWebSwipe({ deltaX: 200, velocityX: 0, windowWidth: 390 })).toBe(true);
    expect(shouldCompleteWebSwipe({ deltaX: 40, velocityX: 700, windowWidth: 390 })).toBe(true);
  });

  it("stays closed for a short slow drag", () => {
    expect(shouldCompleteWebSwipe({ deltaX: 40, velocityX: 120, windowWidth: 390 })).toBe(false);
  });
});
