import { describe, expect, it } from "vitest";
import { parseInlineParts, serializeInlineChip } from "@getpaseo/protocol/inline-chip";
import { insertSelectionAsInlineChip } from "./selection-inline-chip";

describe("insertSelectionAsInlineChip", () => {
  it("appends a paste chip labelled with a preview of the selection", () => {
    const result = insertSelectionAsInlineChip({
      currentText: "Arruma isso por favor",
      selectionText: "Não consigo descriptografar o token.",
    });

    expect(result.text).toContain("Arruma isso por favor ");
    const parts = parseInlineParts(result.text);
    const chip = parts.find((part) => part.kind === "chip");
    expect(chip).toBeDefined();
    if (chip?.kind !== "chip") throw new Error("No chip");
    expect(chip.chip.kind).toBe("paste");
    expect(chip.chip.body).toBe("Não consigo descriptografar o token.");
    expect(chip.chip.label).toBe('"Não consigo descriptografar o token."');
    expect(chip.chip.id.startsWith("paste:")).toBe(true);
    expect(result.selection.start).toBe(result.text.length);
  });

  it("shows the first line of a multi-line selection", () => {
    const result = insertSelectionAsInlineChip({
      currentText: "",
      selectionText: "linha um\nlinha dois\nlinha tres",
    });
    const chip = parseInlineParts(result.text).find((part) => part.kind === "chip");
    if (chip?.kind !== "chip") throw new Error("No chip");
    expect(chip.chip.body).toBe("linha um\nlinha dois\nlinha tres");
    expect(chip.chip.label).toBe('"linha um"');
  });

  it("clips a long first line with an ellipsis", () => {
    const result = insertSelectionAsInlineChip({
      currentText: "",
      selectionText: `${"x".repeat(50)}\nsegunda linha`,
    });
    const chip = parseInlineParts(result.text).find((part) => part.kind === "chip");
    if (chip?.kind !== "chip") throw new Error("No chip");
    expect(chip.chip.label).toBe(`"${"x".repeat(40)}..."`);
  });

  it("does not add a separator to an empty draft or a trailing whitespace", () => {
    const empty = insertSelectionAsInlineChip({
      currentText: "",
      selectionText: "texto",
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
    });
    expect(spaced.text.startsWith("oi ")).toBe(true);
    expect(spaced.text.startsWith("oi  ")).toBe(false);
  });

  it("ignores blank selections", () => {
    const result = insertSelectionAsInlineChip({
      currentText: "oi",
      selectionText: "   \n  ",
    });
    expect(result.text).toBe("oi");
    expect(parseInlineParts(result.text).some((part) => part.kind === "chip")).toBe(false);
  });
});
