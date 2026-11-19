import {
  formatPasteChipLabel,
  insertInlineChipWithSpacing,
  type TextSelection,
} from "@getpaseo/protocol/inline-chip";

/**
 * "Add to chat" is a paste of external text, so it belongs in the sentence as a
 * paste chip, not in the attachment tray. Append at the caret we can know from
 * the store (the end of the draft); the composer keeps the atom clickable.
 */
export function insertSelectionAsInlineChip(input: {
  currentText: string;
  selectionText: string;
}): { text: string; selection: TextSelection } {
  const body = input.selectionText.trim();
  if (body.length === 0) {
    const end = input.currentText.length;
    return { text: input.currentText, selection: { start: end, end: end } };
  }

  const selection: TextSelection = {
    start: input.currentText.length,
    end: input.currentText.length,
  };

  return insertInlineChipWithSpacing({
    text: input.currentText,
    selection,
    chip: {
      id: `paste:${crypto.randomUUID()}`,
      kind: "paste",
      label: formatPasteChipLabel({ body }),
      body,
    },
  });
}
