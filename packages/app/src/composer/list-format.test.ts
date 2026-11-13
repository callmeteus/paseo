import { describe, expect, it } from "vitest";
import {
  composeComposerMirrorPieces,
  continueComposerList,
  findComposerInlineCode,
  findComposerListMarkers,
  hasComposerInlineCode,
  hasComposerListMarker,
  indentComposerList,
} from "./list-format";

const SAMPLE = "Falta\n- Formatação\n1. Aqui no composer!";

describe("composer list markers", () => {
  it("finds a bullet and an ordered marker in a composer draft", () => {
    expect(findComposerListMarkers(SAMPLE)).toEqual([
      { start: 6, end: 7, kind: "bullet" },
      { start: 19, end: 21, kind: "ordered" },
    ]);
    expect(hasComposerListMarker(SAMPLE)).toBe(true);
  });

  it("leaves prose, rules, and markers without a following space untouched", () => {
    expect(findComposerListMarkers("Falta formatação\n---\n1.sem espaço\nusa - no meio")).toEqual(
      [],
    );
    expect(hasComposerListMarker("só texto")).toBe(false);
  });

  it("keeps the marker characters so the mirror stays aligned with the textarea", () => {
    expect(composeComposerMirrorPieces(SAMPLE, [])).toEqual([
      { start: 0, text: "Falta\n", kind: "plain" },
      { start: 6, text: "-", kind: "bullet" },
      { start: 7, text: " Formatação\n", kind: "plain" },
      { start: 19, text: "1.", kind: "ordered" },
      { start: 21, text: " Aqui no composer!", kind: "plain" },
    ]);
  });

  it("keeps the rest of a skill token that starts on a list marker", () => {
    expect(composeComposerMirrorPieces("- /ship", [{ start: 0, end: 7 }])).toEqual([
      { start: 0, text: "-", kind: "bullet" },
      { start: 1, text: " /ship", kind: "skill" },
    ]);
  });
});

describe("continuing a composer list", () => {
  it("opens the next bullet and a second break on the empty item leaves a blank line", () => {
    expect(continueComposerList("- Formatação", { start: 12, end: 12 })).toEqual({
      text: "- Formatação\n- ",
      selection: { start: 15, end: 15 },
    });
    expect(continueComposerList("- Formatação\n- ", { start: 15, end: 15 })).toEqual({
      text: "- Formatação\n",
      selection: { start: 13, end: 13 },
    });
    expect(continueComposerList("- a\n1. b", { start: 3, end: 3 })).toEqual({
      text: "- a\n- \n1. b",
      selection: { start: 6, end: 6 },
    });
  });

  it("opens the next number and renumbers the following items", () => {
    expect(continueComposerList("1. Aqui", { start: 7, end: 7 })).toEqual({
      text: "1. Aqui\n2. ",
      selection: { start: 11, end: 11 },
    });
    expect(continueComposerList("1. a\n2. b\n- c", { start: 4, end: 4 })).toEqual({
      text: "1. a\n2. \n3. b\n- c",
      selection: { start: 8, end: 8 },
    });
    expect(continueComposerList("1. a\n2. b\n3. c", { start: 9, end: 9 })).toEqual({
      text: "1. a\n2. b\n3. \n4. c",
      selection: { start: 13, end: 13 },
    });
    expect(continueComposerList("1. a\n2. b\n   1. sub\n3. c", { start: 9, end: 9 })).toEqual({
      text: "1. a\n2. b\n3. \n   1. sub\n4. c",
      selection: { start: 13, end: 13 },
    });
    expect(continueComposerList("9. a\n10. b", { start: 4, end: 4 })).toEqual({
      text: "9. a\n10. \n11. b",
      selection: { start: 9, end: 9 },
    });
    expect(continueComposerList("1. a\n2. b\n\n3. c", { start: 4, end: 4 })).toEqual({
      text: "1. a\n2. \n3. b\n\n3. c",
      selection: { start: 8, end: 8 },
    });
  });

  it("keeps the marker and indent, and splits the item at the caret", () => {
    expect(continueComposerList("  * a", { start: 5, end: 5 })).toEqual({
      text: "  * a\n  * ",
      selection: { start: 10, end: 10 },
    });
    expect(continueComposerList("+ a", { start: 3, end: 3 })).toEqual({
      text: "+ a\n+ ",
      selection: { start: 6, end: 6 },
    });
    expect(continueComposerList("- abcd", { start: 4, end: 4 })).toEqual({
      text: "- ab\n- cd",
      selection: { start: 7, end: 7 },
    });
    expect(continueComposerList("- item", { start: 0, end: 0 })).toEqual({
      text: "- \n- item",
      selection: { start: 5, end: 5 },
    });
  });

  it("removes an empty item even when another item follows", () => {
    expect(continueComposerList("- a\n- \n- b", { start: 6, end: 6 })).toEqual({
      text: "- a\n\n- b",
      selection: { start: 4, end: 4 },
    });
    expect(continueComposerList("1. a\n2. \n3. c", { start: 8, end: 8 })).toEqual({
      text: "1. a\n\n3. c",
      selection: { start: 5, end: 5 },
    });
    expect(continueComposerList("1. a\n2.   ", { start: 10, end: 10 })).toEqual({
      text: "1. a\n",
      selection: { start: 5, end: 5 },
    });
  });

  it("leaves prose, a selection, and a list inside a code fence as a plain break", () => {
    expect(continueComposerList("hello", { start: 5, end: 5 })).toBeNull();
    expect(continueComposerList("---", { start: 3, end: 3 })).toBeNull();
    expect(continueComposerList("-item", { start: 5, end: 5 })).toBeNull();
    expect(continueComposerList("- item", { start: 0, end: 2 })).toBeNull();
    const fenced = "```\n- item\n```";
    const fencedCaret = "```\n- item".length;
    expect(continueComposerList(fenced, { start: fencedCaret, end: fencedCaret })).toBeNull();
    const afterFence = "```\ncode\n```\n- item";
    expect(
      continueComposerList(afterFence, { start: afterFence.length, end: afterFence.length }),
    ).toEqual({
      text: "```\ncode\n```\n- item\n- ",
      selection: { start: afterFence.length + 3, end: afterFence.length + 3 },
    });
  });
});

describe("indenting a composer list", () => {
  it("nests the item under the caret and keeps the caret on the same character", () => {
    expect(indentComposerList("- Filesystem", { start: 12, end: 12 }, "in")).toEqual({
      text: "  - Filesystem",
      selection: { start: 14, end: 14 },
    });
    expect(indentComposerList("1. Aqui", { start: 6, end: 6 }, "in")).toEqual({
      text: "   1. Aqui",
      selection: { start: 9, end: 9 },
    });
    expect(indentComposerList("  - Filesystem", { start: 14, end: 14 }, "in")).toEqual({
      text: "    - Filesystem",
      selection: { start: 16, end: 16 },
    });
  });

  it("lifts one level, and takes a top-level item out of the list", () => {
    expect(indentComposerList("  - Filesystem", { start: 14, end: 14 }, "out")).toEqual({
      text: "- Filesystem",
      selection: { start: 12, end: 12 },
    });
    expect(indentComposerList("- Filesystem", { start: 4, end: 4 }, "out")).toEqual({
      text: "Filesystem",
      selection: { start: 2, end: 2 },
    });
    expect(indentComposerList("1. Aqui no composer", { start: 6, end: 6 }, "out")).toEqual({
      text: "Aqui no composer",
      selection: { start: 3, end: 3 },
    });
  });

  it("keeps the ordered siblings counting after the item leaves the list", () => {
    expect(indentComposerList("1. a\n2. b\n3. c", { start: 9, end: 9 }, "out")).toEqual({
      text: "1. a\nb\n2. c",
      selection: { start: 6, end: 6 },
    });
    expect(indentComposerList("1. a\n2. b", { start: 5, end: 5 }, "out")).toEqual({
      text: "1. a\nb",
      selection: { start: 5, end: 5 },
    });
  });

  it("indents every selected list line and leaves a mixed selection alone", () => {
    expect(indentComposerList("- a\n- b", { start: 1, end: 6 }, "in")).toEqual({
      text: "  - a\n  - b",
      selection: { start: 3, end: 10 },
    });
    expect(indentComposerList("- a\nprose", { start: 0, end: 8 }, "in")).toBeNull();
    expect(indentComposerList("prose", { start: 2, end: 2 }, "in")).toBeNull();
    const fenced = "```\n- item\n```";
    expect(indentComposerList(fenced, { start: 5, end: 5 }, "in")).toBeNull();
  });
});

describe("composer inline code", () => {
  it("finds a closed pair and leaves an open backtick as plain text", () => {
    expect(findComposerInlineCode("suportar `backticks` agora")).toEqual([{ start: 9, end: 20 }]);
    expect(hasComposerInlineCode("suportar `backticks")).toBe(false);
    expect(findComposerInlineCode("```\n`not code`\n```")).toEqual([]);
    expect(composeComposerMirrorPieces("use `backticks`", [])).toEqual([
      { start: 0, text: "use ", kind: "plain" },
      { start: 4, text: "`backticks`", kind: "code" },
    ]);
  });
});
