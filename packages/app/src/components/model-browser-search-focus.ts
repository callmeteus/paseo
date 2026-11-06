const OVERLAY_KEYS = new Set(["Tab", "Escape", "Enter", "ArrowUp", "ArrowDown"]);

export type SearchKeyFocus = "search" | "overlay";

/**
 * Where a key pressed in the router or model search should leave focus.
 * Typing stays in the field. The back button is the previous control, so a
 * search key must not move focus onto it. Tab, Escape, Enter, and the vertical
 * arrows stay with the open panel.
 */
export function focusAfterSearchKey(input: { key: string }): SearchKeyFocus {
  return OVERLAY_KEYS.has(input.key) ? "overlay" : "search";
}

/** A typing key in the search must take focus back if it lands on the back button. */
export function backButtonShouldYieldToSearch(input: { key: string }): boolean {
  return focusAfterSearchKey(input) === "search";
}
