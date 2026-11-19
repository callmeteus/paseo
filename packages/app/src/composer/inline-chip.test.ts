import { describe, expect, it } from "vitest";
import {
  countPasteLines,
  expandInlineChips,
  formatPasteChipLabel,
  hasInlineChip,
  inlineChipDisplayText,
  insertInlineChip,
  insertTextAtSelection,
  maskInlineChips,
  mentionChipCoversAttachment,
  mentionChipLabel,
  parseInlineParts,
  prepareInlineChipSubmission,
  preserveDisplaySelection,
  removeAdjacentInlineChip,
  serializeInlineChip,
  shouldChipPaste,
  textContainsInlineChipId,
  updateInlineChipBody,
  PASTE_CHIP_MIN_CHARS,
  PASTE_CHIP_MIN_LINES,
  type InlineChip,
} from "@getpaseo/protocol/inline-chip";

const pasteBody = "x".repeat(PASTE_CHIP_MIN_CHARS);
const paste: InlineChip = {
  id: "paste:1",
  kind: "paste",
  label: formatPasteChipLabel({ body: pasteBody }),
  body: pasteBody,
};

describe("paste chips", () => {
  it("keeps a short paste as text and chips a long or multi-line one", () => {
    expect(shouldChipPaste("")).toBe(false);
    expect(shouldChipPaste("   \n  ")).toBe(false);
    expect(shouldChipPaste("a\nb")).toBe(false);
    expect(shouldChipPaste("x".repeat(PASTE_CHIP_MIN_CHARS - 1))).toBe(false);
    expect(shouldChipPaste("a\nb\nc")).toBe(true);
    expect(countPasteLines("a\nb\nc")).toBe(PASTE_CHIP_MIN_LINES);
    expect(shouldChipPaste("x".repeat(PASTE_CHIP_MIN_CHARS))).toBe(true);
    expect(countPasteLines("x".repeat(PASTE_CHIP_MIN_CHARS))).toBe(1);
  });

  it("labels a paste with a quoted preview of its first line", () => {
    expect(formatPasteChipLabel({ body: "Não consigo descriptografar o token." })).toBe(
      '"Não consigo descriptografar o token."',
    );
    expect(formatPasteChipLabel({ body: "primeira linha\nsegunda\nterceira" })).toBe(
      '"primeira linha"',
    );
    expect(formatPasteChipLabel({ body: "  com espaços  \nsegunda" })).toBe('"com espaços"');
    expect(formatPasteChipLabel({ body: "x".repeat(50) })).toBe(`"${"x".repeat(40)}..."`);
    expect(formatPasteChipLabel({ body: "y".repeat(50), maxChars: 10 })).toBe('"yyyyyyyyyy..."');
  });

  it("sits in the middle of a sentence and round-trips the body", () => {
    const before = "eu posso colar ";
    const after = " no meio e continuar escrevendo";
    const body = `linha 1\n"aspas"\n\u001E\u001F café`;
    const chip: InlineChip = {
      id: "paste:mid",
      kind: "paste",
      label: formatPasteChipLabel({ body }),
      body,
    };
    const inserted = insertInlineChip({
      text: `${before}${after}`,
      selection: { start: before.length, end: before.length },
      chip,
    });
    expect(inserted.text.startsWith(before)).toBe(true);
    expect(inserted.text.endsWith(after)).toBe(true);
    expect(inserted.selection).toEqual({
      start: before.length + serializeInlineChip(chip).length,
      end: before.length + serializeInlineChip(chip).length,
    });
    expect(inlineChipDisplayText(inserted.text)).toBe(`${before}"linha 1"${after}`);
    const parts = parseInlineParts(inserted.text);
    expect(parts).toEqual([
      { kind: "text", text: before },
      { kind: "chip", chip },
      { kind: "text", text: after },
    ]);
    expect(expandInlineChips(inserted.text, "prompt")).toBe(`${before}${body}${after}`);
    expect(expandInlineChips(inserted.text, "copy")).toBe(`${before}${body}${after}`);
  });
});

describe("mention chips", () => {
  it("names the chat from its title, then the workspace, then the id", () => {
    expect(mentionChipLabel({ title: "  Pagamentos  ", agentId: "agent-1" })).toBe("Pagamentos");
    expect(mentionChipLabel({ title: " ", workspaceName: " Loja ", agentId: "agent-1" })).toBe(
      "Loja",
    );
    expect(mentionChipLabel({ title: null, agentId: "agent-1" })).toBe("agent-1");
  });

  it("replaces the @ token and covers the matching history attachment", () => {
    const text = "veja @pagamentos por favor";
    const mention = { start: text.indexOf("@"), end: text.indexOf("@") + "@pagamentos".length };
    const chip: InlineChip = {
      id: "chat_history:mention:agent-1",
      kind: "mention",
      label: "Pagamentos",
      body: "",
    };
    const inserted = insertInlineChip({
      text,
      selection: { start: mention.start, end: mention.end },
      chip,
    });
    expect(inlineChipDisplayText(inserted.text)).toBe("veja Pagamentos por favor");
    expect(textContainsInlineChipId(inserted.text, chip.id)).toBe(true);
    const history = "<chat-history-summary>\nola\n</chat-history-summary>";
    const filled = updateInlineChipBody(inserted.text, chip.id, history);
    expect(mentionChipCoversAttachment(filled, history)).toBe(true);
    expect(mentionChipCoversAttachment(filled, "outro")).toBe(false);
    expect(expandInlineChips(filled, "prompt")).toBe("veja Pagamentos por favor");
    expect(expandInlineChips(filled, "copy")).toBe(`veja ${history} por favor`);
    const caret = inserted.selection;
    expect(preserveDisplaySelection(inserted.text, filled, caret)).toEqual({
      start: mapEnd(filled, chip.id),
      end: mapEnd(filled, chip.id),
    });
  });
});

describe("chip editing", () => {
  it("masks chip bodies so an @ inside a paste does not move the caret index", () => {
    const text = insertInlineChip({
      text: "oi ",
      selection: { start: 3, end: 3 },
      chip: { ...paste, body: "email@example.com ".repeat(20) },
    }).text;
    const masked = maskInlineChips(text);
    expect(masked.length).toBe(text.length);
    expect(masked.includes("@")).toBe(false);
    expect(hasInlineChip(text)).toBe(true);
  });

  it("deletes a whole chip with backspace or delete and leaves other text alone", () => {
    const inserted = insertInlineChip({
      text: "antes depois",
      selection: { start: 6, end: 6 },
      chip: paste,
    });
    const chipEnd = inserted.selection.start;
    expect(
      removeAdjacentInlineChip({
        text: inserted.text,
        selection: { start: chipEnd, end: chipEnd },
        direction: "backward",
      })?.text,
    ).toBe("antes depois");
    const chipStart = inserted.text.indexOf("\u001E");
    expect(
      removeAdjacentInlineChip({
        text: inserted.text,
        selection: { start: chipStart, end: chipStart },
        direction: "forward",
      })?.text,
    ).toBe("antes depois");
    expect(
      removeAdjacentInlineChip({
        text: inserted.text,
        selection: { start: 2, end: 2 },
        direction: "backward",
      }),
    ).toBeNull();
  });

  it("sends the paste body to the model and keeps the chip string for history", () => {
    const text = insertTextAtSelection({
      text: "",
      selection: { start: 0, end: 0 },
      insert: serializeInlineChip(paste),
    }).text;
    expect(prepareInlineChipSubmission("sem chip")).toEqual({ promptText: "sem chip" });
    expect(prepareInlineChipSubmission(text)).toEqual({
      promptText: paste.body,
      submittedPromptText: text,
    });
    expect(inlineChipDisplayText(text)).toBe(paste.label);
  });
});

function mapEnd(text: string, id: string): number {
  let offset = 0;
  for (const part of parseInlineParts(text)) {
    if (part.kind === "chip" && part.chip.id === id)
      return offset + serializeInlineChip(part.chip).length;
    offset += part.kind === "text" ? part.text.length : serializeInlineChip(part.chip).length;
  }
  return offset;
}
