import { describe, expect, it } from "vitest";

import { applyDraggedOrder, hasVisibleOrderChanged, mergeWithRemainder } from "./sidebar-reorder";

describe("hasVisibleOrderChanged", () => {
  it("returns false when visible order is unchanged", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["a", "b", "c"],
      }),
    ).toBe(false);
  });

  it("returns true when visible items are reordered", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["b", "a", "c"],
      }),
    ).toBe(true);
  });

  it("returns true when a visible key is missing from current order", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b"],
        reorderedVisibleKeys: ["a", "c"],
      }),
    ).toBe(true);
  });
});

describe("mergeWithRemainder", () => {
  it("appends non-visible stored keys after reordered visible keys", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["a", "x", "b", "y"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["b", "a", "x", "y"]);
  });

  it("keeps unknown current keys when no visible keys are reordered", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["stale", "hidden"],
        reorderedVisibleKeys: [],
      }),
    ).toEqual(["stale", "hidden"]);
  });
});

describe("applyDraggedOrder", () => {
  it("returns null when the dragged rows are already in that order", () => {
    expect(
      applyDraggedOrder({
        currentOrder: ["host-a:1", "host-b:1", "host-a:2"],
        reorderedVisibleKeys: ["host-a:1", "host-a:2"],
        preserveOtherSlots: true,
      }),
    ).toBeNull();
  });

  it("keeps another server's workspace where it was", () => {
    expect(
      applyDraggedOrder({
        currentOrder: ["host-a:1", "host-b:1", "host-a:2"],
        reorderedVisibleKeys: ["host-a:2", "host-a:1"],
        preserveOtherSlots: true,
      }),
    ).toEqual(["host-a:2", "host-b:1", "host-a:1"]);
  });

  it("appends a dragged key that was not stored yet, after the other server", () => {
    expect(
      applyDraggedOrder({
        currentOrder: ["host-b:1"],
        reorderedVisibleKeys: ["host-a:2", "host-a:1"],
        preserveOtherSlots: true,
      }),
    ).toEqual(["host-b:1", "host-a:2", "host-a:1"]);
  });

  it("puts filtered-out rows after the dragged rows on the flat list", () => {
    expect(
      applyDraggedOrder({
        currentOrder: ["a", "hidden", "b"],
        reorderedVisibleKeys: ["b", "a"],
        preserveOtherSlots: false,
      }),
    ).toEqual(["b", "a", "hidden"]);
  });
});
