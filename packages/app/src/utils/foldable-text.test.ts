import { describe, expect, it } from "vitest";
import { isFoldableText } from "./foldable-text";

describe("foldable text", () => {
  it("folds a short plain sentence", () => {
    expect(isFoldableText("Now checking the config")).toBe(true);
  });

  it("keeps a reply that runs past the length limit", () => {
    expect(isFoldableText("a".repeat(101))).toBe(false);
  });

  it("keeps anything longer than two lines", () => {
    expect(isFoldableText("one\ntwo\nthree")).toBe(false);
  });

  it("keeps fenced code", () => {
    expect(isFoldableText("Run this:\n```sh\nnpm test\n```")).toBe(false);
  });

  it("keeps a heading", () => {
    expect(isFoldableText("## Result")).toBe(false);
  });

  it("keeps a bullet list", () => {
    expect(isFoldableText("- one\n- two")).toBe(false);
  });

  it("keeps a table", () => {
    expect(isFoldableText("| a | b |")).toBe(false);
  });

  it("does not fold blank text", () => {
    expect(isFoldableText("   ")).toBe(false);
  });
});
