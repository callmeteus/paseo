import { describe, expect, it } from "vitest";

import { backButtonShouldYieldToSearch, focusAfterSearchKey } from "./model-browser-search-focus";

describe("model browser search focus", () => {
  it("keeps a search key in the field instead of the back button", () => {
    for (const key of ["d", "e", " ", "Backspace", "Delete", "ArrowLeft", "ArrowRight"]) {
      expect(focusAfterSearchKey({ key })).toBe("search");
      expect(backButtonShouldYieldToSearch({ key })).toBe(true);
    }
  });

  it("leaves Tab, Escape, Enter, and vertical arrows with the open panel", () => {
    for (const key of ["Tab", "Escape", "Enter", "ArrowUp", "ArrowDown"]) {
      expect(focusAfterSearchKey({ key })).toBe("overlay");
      expect(backButtonShouldYieldToSearch({ key })).toBe(false);
    }
  });
});
