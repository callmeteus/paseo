import { buildTableModel, TABLE_COLUMN_LIMIT, TABLE_ROW_LIMIT, type TableModel } from "./model";

export interface WorkbookSheet {
  name: string;
  table: TableModel;
}

export interface WorkbookPreview {
  sheets: WorkbookSheet[];
}

/** More sheets than anyone reads at once; the rest stay in the file, unread. */
const SHEET_LIMIT = 20;

let parser: Promise<typeof import("@e965/xlsx")> | null = null;

/**
 * The parser is ~1 MB, so it loads on the first spreadsheet a tab opens rather than at app start.
 * One promise for the process: a second panel waits on the same read.
 */
function loadParser(): Promise<typeof import("@e965/xlsx")> {
  parser ??= import("@e965/xlsx");
  return parser;
}

/**
 * Reads an XLSX, XLSM, XLS or ODS workbook into the grids the panel draws. Cells come back
 * formatted by the sheet's own number formats, so currency, percentages and dates read as the
 * author wrote them instead of as raw serial numbers.
 */
export async function readWorkbook(bytes: Uint8Array): Promise<WorkbookPreview> {
  const xlsx = await loadParser();
  const workbook = xlsx.read(bytes, { type: "array" });
  const sheets: WorkbookSheet[] = [];

  for (const [index, name] of workbook.SheetNames.entries()) {
    if (workbook.Workbook?.Sheets?.[index]?.Hidden) continue;
    if (sheets.length >= SHEET_LIMIT) break;
    const sheet = workbook.Sheets[name];
    sheets.push({
      name,
      table: sheet ? readSheet(xlsx, sheet) : buildTableModel({ rows: [] }),
    });
  }

  return { sheets };
}

function readSheet(
  xlsx: typeof import("@e965/xlsx"),
  sheet: import("@e965/xlsx").WorkSheet,
): TableModel {
  const reference = sheet["!ref"];
  if (!reference) return buildTableModel({ rows: [] });

  const range = xlsx.utils.decode_range(reference);
  const lastRow = Math.min(range.e.r, range.s.r + TABLE_ROW_LIMIT - 1);
  const lastColumn = Math.min(range.e.c, range.s.c + TABLE_COLUMN_LIMIT - 1);
  const grid = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
    range: {
      s: { r: range.s.r, c: range.s.c },
      e: { r: lastRow, c: lastColumn },
    },
  });

  return buildTableModel({
    rows: grid.map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
    ),
    rowCount: range.e.r - range.s.r + 1,
    columnCount: range.e.c - range.s.c + 1,
  });
}
