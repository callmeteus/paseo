import { describe, expect, it } from "vitest";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";

describe("dragStateReducer", () => {
  it("tracks the row the drag started on", () => {
    const next = dragStateReducer(dragStateInitial<string>(), {
      type: "start",
      id: "alpha",
      items: ["alpha"],
    });

    expect(next.activeId).toBe("alpha");
  });

  it("starts tracking the active item with the rows on screen", () => {
    const next = dragStateReducer(dragStateInitial<string>(), {
      type: "start",
      id: "alpha",
      items: ["alpha", "beta"],
    });

    expect(next).toEqual({ activeId: "alpha", dragItems: ["alpha", "beta"], dropped: null });
  });

  it("clears the active row", () => {
    const next = dragStateReducer(
      { activeId: "alpha", dragItems: ["alpha"], dropped: null },
      { type: "clear" },
    );

    expect(next.activeId).toBeNull();
  });

  it("clears the active item and the rows", () => {
    const next = dragStateReducer(
      { activeId: "alpha", dragItems: ["alpha", "beta"], dropped: null },
      { type: "clear" },
    );

    expect(next).toEqual({ activeId: null, dragItems: null, dropped: null });
  });

  it("holds the dropped order in place of the order it replaces", () => {
    const dropped = { order: ["beta", "alpha"], replaces: ["alpha", "beta"] };
    const next = dragStateReducer(
      { activeId: "alpha", dragItems: ["alpha", "beta"], dropped: null },
      { type: "drop", dropped },
    );

    expect(next).toEqual({ activeId: null, dragItems: null, dropped });
  });

  it("replaces an in-flight drag when a new one starts", () => {
    const next = dragStateReducer(
      { activeId: "alpha", dragItems: ["alpha"], dropped: null },
      { type: "start", id: "beta", items: ["beta"] },
    );

    expect(next).toEqual({ activeId: "beta", dragItems: ["beta"], dropped: null });
  });
});
