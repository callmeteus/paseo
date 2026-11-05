import { describe, expect, it } from "vitest";
import {
  buildTableModel,
  columnLetter,
  detectHeaderRow,
  looksNumeric,
  normalizeCell,
  TABLE_CELL_LIMIT,
  TABLE_COLUMN_LIMIT,
  TABLE_ROW_LIMIT,
  tableBodyRows,
  tableHeaderLabels,
} from "./model";

describe("detectHeaderRow", () => {
  it("reads a row of distinct labels over data as a header", () => {
    expect(
      detectHeaderRow([
        ["name", "amount", "date"],
        ["Coffee", "12", "2024-01-02"],
      ]),
    ).toBe(true);
  });

  it("does not read a first row of numbers as a header", () => {
    expect(
      detectHeaderRow([
        ["1", "2", "3"],
        ["4", "5", "6"],
      ]),
    ).toBe(false);
  });

  it("does not read repeated labels or a lone row as a header", () => {
    expect(
      detectHeaderRow([
        ["value", "value"],
        ["a", "b"],
      ]),
    ).toBe(false);
    expect(detectHeaderRow([["name", "amount"]])).toBe(false);
  });

  it("does not read a row of dates as a header", () => {
    expect(
      detectHeaderRow([
        ["2024-01-01", "2024-02-01"],
        ["1", "2"],
      ]),
    ).toBe(false);
  });
});

describe("looksNumeric", () => {
  it("accepts grouped, decimal, signed and currency values", () => {
    for (const value of ["12", "1.234,56", "1,234.56", "-3.5", "5%", "R$ 1.200,00", "$12"]) {
      expect(looksNumeric(value)).toBe(true);
    }
  });

  it("rejects words, dates and empty cells", () => {
    for (const value of ["", "Coffee", "2024-01-02", "12/03/2024", "a1"]) {
      expect(looksNumeric(value)).toBe(false);
    }
  });
});

describe("columnLetter", () => {
  it("names columns the way a spreadsheet does", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(51)).toBe("AZ");
  });
});

describe("normalizeCell", () => {
  it("flattens whitespace and clips a long value", () => {
    expect(normalizeCell("two\nlines")).toBe("two lines");
    expect(normalizeCell(null)).toBe("");
    expect(normalizeCell("x".repeat(TABLE_CELL_LIMIT + 10))).toHaveLength(TABLE_CELL_LIMIT + 1);
  });
});

describe("buildTableModel", () => {
  it("pads rows to the widest record and trims trailing empty rows", () => {
    const table = buildTableModel({
      rows: [
        ["name", "amount", "note"],
        ["Coffee", "12"],
        ["", "", ""],
      ],
    });
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]).toEqual(["Coffee", "12", ""]);
    expect(table.hasHeader).toBe(true);
    expect(tableHeaderLabels(table)).toEqual(["name", "amount", "note"]);
    expect(tableBodyRows(table)).toEqual([["Coffee", "12", ""]]);
  });

  it("labels columns by letter and keeps every row when the first row is data", () => {
    const table = buildTableModel({
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
    expect(table.hasHeader).toBe(false);
    expect(tableHeaderLabels(table)).toEqual(["A", "B"]);
    expect(tableBodyRows(table)).toHaveLength(2);
  });

  it("caps rows and columns and reports what it left out", () => {
    const rows = grid(TABLE_ROW_LIMIT + 5, TABLE_COLUMN_LIMIT + 2);
    const table = buildTableModel({ rows });
    expect(table.rows).toHaveLength(TABLE_ROW_LIMIT);
    expect(table.rows[0]).toHaveLength(TABLE_COLUMN_LIMIT);
    expect(table.rowsTruncated).toBe(true);
    expect(table.columnsTruncated).toBe(true);
    expect(table.rowCount).toBe(TABLE_ROW_LIMIT + 5);
    expect(table.columnCount).toBe(TABLE_COLUMN_LIMIT + 2);
  });

  it("reports an unknown total as truncated once it hits the row cap", () => {
    const rows = Array.from({ length: TABLE_ROW_LIMIT }, () => ["value"]);
    const table = buildTableModel({ rows, rowCount: null });
    expect(table.rowCount).toBeNull();
    expect(table.rowsTruncated).toBe(true);
  });

  it("has no rows for an empty file", () => {
    const table = buildTableModel({ rows: [] });
    expect(table.rows).toEqual([]);
    expect(table.columnCount).toBe(1);
    expect(table.rowsTruncated).toBe(false);
  });
});

function grid(rowCount: number, columnCount: number): string[][] {
  const rows: string[][] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const cells: string[] = [];
    for (let column = 0; column < columnCount; column += 1) cells.push(`${row}:${column}`);
    rows.push(cells);
  }
  return rows;
}
