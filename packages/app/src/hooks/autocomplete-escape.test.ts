import { describe, expect, it, vi } from "vitest";
import { resolveAutocompleteEscape, type AutocompleteEscapeArgs } from "./autocomplete-escape";

function args(overrides: Partial<AutocompleteEscapeArgs> = {}): AutocompleteEscapeArgs {
  return {
    mode: null,
    slashCommand: null,
    fileMention: null,
    clearInput: vi.fn(),
    dismissCommand: vi.fn(),
    dismissMention: vi.fn(),
    ...overrides,
  };
}

describe("resolveAutocompleteEscape", () => {
  it("dismisses a slash at the start without clearing the chat", () => {
    const input = args({
      mode: "command",
      slashCommand: { start: 0, end: 2, query: "", position: "start" },
    });

    const escape = resolveAutocompleteEscape(input);
    expect(escape).toBeDefined();
    escape?.();
    expect(input.dismissCommand).toHaveBeenCalledWith(0);
    expect(input.clearInput).not.toHaveBeenCalled();
  });

  it("dismisses an inline slash command without touching the input", () => {
    const input = args({
      mode: "command",
      slashCommand: { start: 42, end: 43, query: "", position: "inline" },
    });

    const escape = resolveAutocompleteEscape(input);
    expect(escape).toBeDefined();
    escape?.();
    expect(input.dismissCommand).toHaveBeenCalledWith(42);
    expect(input.clearInput).not.toHaveBeenCalled();
  });

  it("still dismisses a file mention", () => {
    const input = args({
      mode: "file",
      fileMention: { start: 7, end: 9, query: "ab" },
    });

    resolveAutocompleteEscape(input)?.();
    expect(input.dismissMention).toHaveBeenCalledWith(7);
  });

  it("leaves Escape to the global shortcut with no open token", () => {
    expect(resolveAutocompleteEscape(args())).toBeUndefined();
  });
});
