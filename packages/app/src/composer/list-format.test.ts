import { describe, expect, it } from "vitest";
import {
  composeComposerMirrorPieces,
  findComposerListMarkers,
  hasComposerListMarker,
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
