import { describe, expect, it } from "vitest";
import { detectDelimiter, parseDelimitedText } from "./parse-delimited";

describe("detectDelimiter", () => {
  it("reads comma, semicolon, tab and pipe separated files", () => {
    expect(detectDelimiter("name,amount\ncoffee,12\n")).toBe(",");
    expect(detectDelimiter("name;amount\ncoffee;12\n")).toBe(";");
    expect(detectDelimiter("name\tamount\ncoffee\t12\n")).toBe("\t");
    expect(detectDelimiter("name|amount\ncoffee|12\n")).toBe("|");
  });

  it("reads a semicolon file whose numbers use decimal commas", () => {
    expect(detectDelimiter('item;price;note\n"Coffee, ground";1,50;"1,5 kg"\n')).toBe(";");
  });

  it("does not count a separator inside a quoted value", () => {
    expect(detectDelimiter('name;note\ncoffee;"a, b, c"\ncoffee;"d, e, f"\n')).toBe(";");
  });

  it("falls back to a comma when no line has a separator", () => {
    expect(detectDelimiter("name\ncoffee\n")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
});

describe("parseDelimitedText", () => {
  it("reads quoted values, escaped quotes and separators inside them", () => {
    const parsed = parseDelimitedText('a;b\n"say ""hi""";"x;y"\n');
    expect(parsed.delimiter).toBe(";");
    expect(parsed.rows).toEqual([
      ["a", "b"],
      ['say "hi"', "x;y"],
    ]);
  });

  it("ends records on CRLF and does not open a record for the trailing newline", () => {
    expect(parseDelimitedText("a,b\r\n1,2\r\n").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops blank lines and keeps empty trailing fields", () => {
    expect(parseDelimitedText("a,b\n\n1,\n").rows).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });

  it("drops a byte order mark from the first value", () => {
    expect(parseDelimitedText("\uFEFFname,value\n").rows).toEqual([["name", "value"]]);
  });

  it("counts rows and columns past the caps instead of keeping them", () => {
    const rows = Array.from({ length: 5 }, (_, index) => `${index},${index},${index}`).join("\n");
    const parsed = parseDelimitedText(rows, { rowLimit: 2, columnLimit: 2 });
    expect(parsed.rows).toEqual([
      ["0", "0"],
      ["1", "1"],
    ]);
    expect(parsed.rowCount).toBe(5);
    expect(parsed.columnCount).toBe(3);
  });

  it("counts a last record that has no trailing newline", () => {
    expect(parseDelimitedText("a,b\n1,2").rowCount).toBe(2);
  });
});
