import { describe, expect, it } from "vitest";
import { PASTE_CHIP_MIN_CHARS } from "@getpaseo/protocol/inline-chip";
import { composerPasteAction, isPlainTextPasteShortcut, type PasteShortcutEvent } from "./paste";

const LONG = "x".repeat(PASTE_CHIP_MIN_CHARS);
const LINES = "a\nb\nc";

function shortcut(overrides: Partial<PasteShortcutEvent>): PasteShortcutEvent {
  return {
    key: "v",
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("plain text paste", () => {
  it("treats Ctrl+Shift+V and Cmd+Shift+V as paste without a chip", () => {
    expect(isPlainTextPasteShortcut(shortcut({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isPlainTextPasteShortcut(shortcut({ key: "V", metaKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(isPlainTextPasteShortcut(shortcut({ ctrlKey: true }))).toBe(false);
    expect(
      isPlainTextPasteShortcut(shortcut({ ctrlKey: true, shiftKey: true, altKey: true })),
    ).toBe(false);
    expect(isPlainTextPasteShortcut(shortcut({ key: "c", ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
  });

  it("lets the textarea insert a plain long paste and still chips a normal one", () => {
    expect(composerPasteAction({ text: LINES, rich: false, plain: true })).toBeNull();
    expect(composerPasteAction({ text: LONG, rich: false, plain: true })).toBeNull();
    expect(composerPasteAction({ text: LINES, rich: false, plain: false })).toEqual({ chip: true });
    expect(composerPasteAction({ text: "short", rich: false, plain: false })).toBeNull();
  });

  it("inserts a plain long paste into the chip editor as text", () => {
    expect(composerPasteAction({ text: LINES, rich: true, plain: true })).toEqual({ chip: false });
    expect(composerPasteAction({ text: LONG, rich: true, plain: false })).toEqual({ chip: true });
    expect(composerPasteAction({ text: "", rich: true, plain: true })).toBeNull();
  });
});
