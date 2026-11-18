import { shouldChipPaste } from "@getpaseo/protocol/inline-chip";

export interface PasteShortcutEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Ctrl+Shift+V and Cmd+Shift+V paste the clipboard text without turning it into a chip. */
export function isPlainTextPasteShortcut(event: PasteShortcutEvent): boolean {
  if (!event.shiftKey || event.altKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key.toLowerCase() === "v";
}

export interface ComposerPasteAction {
  chip: boolean;
}

/**
 * `null` leaves the paste to the browser. A plain textarea can insert short or
 * unformatted text itself. The chip editor has to insert every paste.
 */
export function composerPasteAction(input: {
  text: string;
  rich: boolean;
  plain: boolean;
}): ComposerPasteAction | null {
  if (input.text.length === 0) return null;
  const chip = !input.plain && shouldChipPaste(input.text);
  if (!input.rich && !chip) return null;
  return { chip };
}
