import { describe, expect, it } from "vitest";
import {
  countPasteLines,
  parseInlineParts,
  serializeInlineChip,
} from "@getpaseo/protocol/inline-chip";
import { insertSelectionAsInlineChip, type SelectionChipLabels } from "./selection-inline-chip";

const labels: SelectionChipLabels = {
  pastedWord: "Colado",
  lineOne: "linha",
  lineOther: "linhas",
};

describe("insertSelectionAsInlineChip", () => {
  it("appends a paste chip with a localized label", () => {
    const result = insertSelectionAsInlineChip({
      currentText: "Arruma isso por favor",
      selectionText: "Não consigo descriptografar o token.",
      labels,
    });

    expect(result.text).toContain("Arruma isso por favor ");
    const parts = parseInlineParts(result.text);
    const chip = parts.find((part) => part.kind === "chip");
    expect(chip).toBeDefined();
    if (chip?.kind !== "chip") throw new Error("No chip");
    expect(chip.chip.kind).toBe("paste");
    expect(chip.chip.body).toBe("Não consigo descriptografar o token.");
    expect(chip.chip.label).toBe("[Colado ~1 linha]");
    expect(chip.chip.id.startsWith("paste:")).toBe(true);
    expect(result.selection.start).toBe(result.text.length);
  });

  it("uses the plural word for multiple lines", () => {
    const selection = "linha um\nlinha dois\nlinha tres";
    const result = insertSelectionAsInlineChip({
      currentText: "",
      selectionText: selection,
      labels,
    });
    const chip = parseInlineParts(result.text).find((part) => part.kind === "chip");
    if (chip?.kind !== "chip") throw new Error("No chip");
    expect(countPasteLines(selection)).toBe(3);
    expect(chip.chip.label).toBe("[Colado ~3 linhas]");
  });

  it("does not add a separator to an empty draft or a trailing whitespace", () => {
    const empty = insertSelectionAsInlineChip({
      currentText: "",
      selectionText: "texto",
      labels,
    });
    expect(empty.text).toBe(
      parseInlineParts(empty.text)
        .map((p) => (p.kind === "text" ? p.text : serializeInlineChip(p.chip)))
        .join(""),
    );
    expect(parseInlineParts(empty.text)[0]?.kind).toBe("chip");

    const spaced = insertSelectionAsInlineChip({
      currentText: "oi ",
      selectionText: "texto",
      labels,
    });
    expect(spaced.text.startsWith("oi ")).toBe(true);
    expect(spaced.text.startsWith("oi  ")).toBe(false);
  });

  it("ignores blank selections", () => {
    const result = insertSelectionAsInlineChip({
      currentText: "oi",
      selectionText: "   \n  ",
      labels,
    });
    expect(result.text).toBe("oi");
    expect(parseInlineParts(result.text).some((part) => part.kind === "chip")).toBe(false);
  });
});
