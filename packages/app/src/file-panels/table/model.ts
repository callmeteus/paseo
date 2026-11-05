/**
 * What a table panel keeps from a file. A grid is a read-only view, so the caps keep a 500k-row
 * export from becoming 500k cells and a stray megabyte-long note from owning a row. What the caps
 * drop is reported by the footer, never silently.
 */
export const TABLE_ROW_LIMIT = 2000;
export const TABLE_COLUMN_LIMIT = 50;
export const TABLE_CELL_LIMIT = 500;

export interface TableModel {
  /** The rows the panel keeps, the header row included when `hasHeader`. */
  rows: readonly (readonly string[])[];
  hasHeader: boolean;
  /**
   * Records the file has, including the header row, or null when the panel read a prefix of a
   * file too large to parse whole. More than `rows.length` when truncated.
   */
  rowCount: number | null;
  /** Columns the file has, including empties the panel trimmed. More than the kept width. */
  columnCount: number;
  rowsTruncated: boolean;
  columnsTruncated: boolean;
}

const NUMERIC_PATTERN = /^[-+]?[\d.,\s]*\d[\d.,\s]*%?$/;
const DATE_PATTERN = /^\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,4})?(?:[ T].*)?$/;
const CURRENCY_PREFIX = /^(?:R\$|US\$|\$|€|£|¥)\s*/;

export function buildTableModel(input: {
  rows: readonly (readonly string[])[];
  /** Records the file has, when the caller counted more than it kept, or null when unknown. */
  rowCount?: number | null;
  /** Columns the file has, when the caller counted more than it kept. */
  columnCount?: number;
}): TableModel {
  const rows = trimTrailingEmptyRows(input.rows);
  const columnCount = Math.max(input.columnCount ?? 0, widestRow(rows), 1);
  const keptColumns = Math.min(columnCount, TABLE_COLUMN_LIMIT);
  const keptRows = rows
    .slice(0, TABLE_ROW_LIMIT)
    .map((row) => padRow(row.map(normalizeCell), keptColumns));
  const rowCount = input.rowCount === undefined ? rows.length : input.rowCount;
  // A sheet's used range can reach past its last filled row; only the cap drops rows.
  const rowsTruncated =
    keptRows.length >= TABLE_ROW_LIMIT && (rowCount === null || rowCount > keptRows.length);
  return {
    rows: keptRows,
    hasHeader: detectHeaderRow(keptRows),
    rowCount,
    columnCount,
    rowsTruncated,
    columnsTruncated: columnCount > keptColumns,
  };
}

/** The header labels a grid draws: the file's first row when it reads as one, else column letters. */
export function tableHeaderLabels(table: TableModel): string[] {
  const width = Math.min(table.columnCount, TABLE_COLUMN_LIMIT);
  if (table.hasHeader && table.rows[0]) {
    return padRow(table.rows[0], width).map((cell, index) =>
      cell.trim() === "" ? columnLetter(index) : cell,
    );
  }
  return Array.from({ length: width }, (_, index) => columnLetter(index));
}

/** The data rows a grid draws, without the header row when the file's first row is the header. */
export function tableBodyRows(table: TableModel): readonly (readonly string[])[] {
  return table.hasHeader ? table.rows.slice(1) : table.rows;
}

/**
 * Whether a file's first row is its header. Every cell must carry a label, none may read as a
 * number or a date, and the labels must be distinct - the shape of a header, not of data.
 */
export function detectHeaderRow(rows: readonly (readonly string[])[]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  if (first.length === 0) return false;
  const filled = first.filter((cell) => cell.trim() !== "");
  if (filled.length * 2 < first.length + 1) return false;
  if (filled.some((cell) => looksNumeric(cell) || looksDate(cell))) return false;
  const labels = filled.map((cell) => cell.trim().toLowerCase());
  return new Set(labels).size === labels.length;
}

export function looksNumeric(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return NUMERIC_PATTERN.test(text.replace(CURRENCY_PREFIX, ""));
}

function looksDate(value: string): boolean {
  return DATE_PATTERN.test(value.trim());
}

/** "A" for the first column, "AA" for the 27th. */
export function columnLetter(index: number): string {
  let remaining = index + 1;
  let letters = "";
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** One cell on one line: a cell never wraps, so row heights stay uniform. */
export function normalizeCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TABLE_CELL_LIMIT ? `${flat.slice(0, TABLE_CELL_LIMIT)}…` : flat;
}

function widestRow(rows: readonly (readonly string[])[]): number {
  let widest = 0;
  for (const row of rows) widest = Math.max(widest, row.length);
  return widest;
}

function padRow(row: readonly string[], width: number): string[] {
  if (row.length === width) return [...row];
  const padded = row.slice(0, width);
  while (padded.length < width) padded.push("");
  return padded;
}

function trimTrailingEmptyRows(
  rows: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((cell) => cell.trim() === "")) end -= 1;
  return rows.slice(0, end);
}

export function formatCount(value: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale).format(value);
}
