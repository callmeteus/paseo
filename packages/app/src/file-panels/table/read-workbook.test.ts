import { utils, write } from "@e965/xlsx";
import { describe, expect, it } from "vitest";
import { TABLE_COLUMN_LIMIT, TABLE_ROW_LIMIT } from "./model";
import { readWorkbook } from "./read-workbook";

function workbookBytes(
  sheets: { name: string; rows: unknown[][]; hidden?: boolean }[],
): Uint8Array {
  const workbook = utils.book_new();
  for (const sheet of sheets) {
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(sheet.rows), sheet.name);
    if (sheet.hidden) utils.book_set_sheet_visibility(workbook, sheet.name, 1);
  }
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("readWorkbook", () => {
  it("reads every sheet with its own header and numbers", async () => {
    const bytes = workbookBytes([
      {
        name: "Sales",
        rows: [
          ["Region", "Amount"],
          ["North", 1200],
          ["South", 950.5],
        ],
      },
      { name: "Notes", rows: [["Ship"], ["Friday"]] },
    ]);

    const { sheets } = await readWorkbook(bytes);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Sales", "Notes"]);
    expect(sheets[0].table.hasHeader).toBe(true);
    expect(sheets[0].table.rows).toEqual([
      ["Region", "Amount"],
      ["North", "1200"],
      ["South", "950.5"],
    ]);
    expect(sheets[1].table.rows).toEqual([["Ship"], ["Friday"]]);
  });

  it("leaves a hidden sheet out", async () => {
    const bytes = workbookBytes([
      { name: "Visible", rows: [["a"], ["b"]] },
      { name: "Hidden", rows: [["c"]], hidden: true },
    ]);

    const { sheets } = await readWorkbook(bytes);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Visible"]);
  });

  it("caps a sheet with more rows and columns than the grid keeps", async () => {
    const rows: unknown[][] = [["row", "column"]];
    for (let index = 0; index < TABLE_ROW_LIMIT + 5; index += 1) {
      rows.push([index, ...Array.from({ length: TABLE_COLUMN_LIMIT }, (_, column) => column)]);
    }

    const { sheets } = await readWorkbook(workbookBytes([{ name: "Big", rows }]));
    expect(sheets[0].table.rows).toHaveLength(TABLE_ROW_LIMIT);
    expect(sheets[0].table.rowsTruncated).toBe(true);
    expect(sheets[0].table.columnsTruncated).toBe(true);
  });
});
