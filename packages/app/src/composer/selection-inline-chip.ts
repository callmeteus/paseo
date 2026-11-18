import {
  countPasteLines,
  formatPasteChipLabel,
  insertInlineChip,
  type TextSelection,
} from "@getpaseo/protocol/inline-chip";

export interface SelectionChipLabels {
  pastedWord: string;
  lineOne: string;
  lineOther: string;
}

/**
 * "Add to chat" is a paste of external text, so it belongs in the sentence as a
 * paste chip, not in the attachment tray. Append at the caret we can know from
 * the store (the end of the draft); the composer keeps the atom clickable.
 */
export function insertSelectionAsInlineChip(input: {
  currentText: string;
  selectionText: string;
  labels: SelectionChipLabels;
}): { text: string; selection: TextSelection } {
  const body = input.selectionText.trim();
  if (body.length === 0) {
    const end = input.currentText.length;
    return { text: input.currentText, selection: { start: end, end: end } };
  }

  const count = countPasteLines(body);
  const needsSpace = input.currentText.length > 0 && !/\s$/.test(input.currentText);
  const base = needsSpace ? `${input.currentText} ` : input.currentText;
  const selection: TextSelection = { start: base.length, end: base.length };

  return insertInlineChip({
    text: base,
    selection,
    chip: {
      id: `paste:${crypto.randomUUID()}`,
      kind: "paste",
      label: formatPasteChipLabel({
        count,
        pastedWord: input.labels.pastedWord,
        lineWord: count === 1 ? input.labels.lineOne : input.labels.lineOther,
      }),
      body,
    },
  });
}
