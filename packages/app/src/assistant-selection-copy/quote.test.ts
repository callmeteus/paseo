import { describe, expect, it } from "vitest";
import { appendSelectionToDraftText, formatSelectionQuote } from "./quote";

describe("formatSelectionQuote", () => {
  it("prefixes every line as a Markdown blockquote", () => {
    expect(formatSelectionQuote("First line\nSecond line")).toBe("> First line\n> Second line");
  });

  it("keeps blank lines inside the quote", () => {
    expect(formatSelectionQuote("First\n\nSecond")).toBe("> First\n>\n> Second");
  });
});

describe("appendSelectionToDraftText", () => {
  it("starts the draft with the quote and a blank line for the question", () => {
    expect(appendSelectionToDraftText("", "Selected text")).toBe("> Selected text\n\n");
  });

  it("appends below existing draft text", () => {
    expect(appendSelectionToDraftText("What does this mean?", "Selected text")).toBe(
      "What does this mean?\n\n> Selected text\n\n",
    );
  });

  it("ignores a draft made only of whitespace", () => {
    expect(appendSelectionToDraftText("  \n", "Selected text")).toBe("> Selected text\n\n");
  });
});
