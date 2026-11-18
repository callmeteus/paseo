import { describe, expect, it } from "vitest";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";

describe("dragStateReducer", () => {
  it("tracks the row the drag started on", () => {
    const next = dragStateReducer(dragStateInitial(), {
      type: "start",
      id: "alpha",
    });

    expect(next).toEqual({ activeId: "alpha" });
  });

  it("clears the active row", () => {
    const next = dragStateReducer({ activeId: "alpha" }, { type: "clear" });

    expect(next).toEqual({ activeId: null });
  });

  it("replaces an in-flight drag when a new one starts", () => {
    const next = dragStateReducer({ activeId: "alpha" }, { type: "start", id: "beta" });

    expect(next).toEqual({ activeId: "beta" });
  });
});
