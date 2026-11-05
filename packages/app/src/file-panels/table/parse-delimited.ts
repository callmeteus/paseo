import { TABLE_COLUMN_LIMIT, TABLE_ROW_LIMIT } from "./model";

export const DELIMITERS = [",", ";", "\t", "|"] as const;

export type Delimiter = (typeof DELIMITERS)[number];

export interface DelimitedText {
  rows: string[][];
  delimiter: Delimiter;
  /** Records the file has, which may be more than `rows` holds. */
  rowCount: number;
  /** Columns the widest record has, which may be more than the kept rows hold. */
  columnCount: number;
}

/**
 * Reads a delimited text file (CSV, TSV, semicolon-separated) with RFC 4180 quoting. Rows and
 * columns past the caps are counted, not kept: the footer reports what the grid leaves out.
 *
 * A trailing newline does not open a record, and blank lines carry no record - both are how every
 * spreadsheet reader treats an export.
 */
export function parseDelimitedText(
  text: string,
  options: { rowLimit?: number; columnLimit?: number } = {},
): DelimitedText {
  const rowLimit = options.rowLimit ?? TABLE_ROW_LIMIT;
  const columnLimit = options.columnLimit ?? TABLE_COLUMN_LIMIT;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fields = 0;
  let rowCount = 0;
  let columnCount = 0;
  let keeping = true;
  let touched = false;
  let quoted = false;

  const endField = () => {
    if (keeping && row.length < columnLimit) row.push(field);
    field = "";
    fields += 1;
  };

  const endRow = () => {
    endField();
    if (keeping) rows.push(row);
    row = [];
    rowCount += 1;
    if (fields > columnCount) columnCount = fields;
    if (keeping && rows.length >= rowLimit) keeping = false;
    fields = 0;
    touched = false;
  };

  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') {
        field += character;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
      touched = true;
      continue;
    }
    if (character === delimiter) {
      endField();
      touched = true;
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (touched) endRow();
      continue;
    }
    field += character;
    touched = true;
  }
  if (touched) endRow();

  return { rows, delimiter, rowCount, columnCount: Math.max(columnCount, 1) };
}

/**
 * The delimiter that splits the sample into the most columns on the most lines. Semicolon exports
 * are the norm in locales that write decimal commas, so a comma-only guess misreads them.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .slice(0, 64 * 1024)
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 20);
  if (lines.length === 0) return ",";

  let best: { delimiter: Delimiter; score: number } = { delimiter: ",", score: 0 };
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countSeparators(line, delimiter));
    if (counts.every((count) => count === 0)) continue;
    const frequencies = new Map<number, number>();
    for (const count of counts) frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
    let modal = 0;
    let modalFrequency = 0;
    for (const [count, frequency] of frequencies) {
      if (count === 0) continue;
      if (frequency > modalFrequency || (frequency === modalFrequency && count > modal)) {
        modal = count;
        modalFrequency = frequency;
      }
    }
    // Consistency first, then how many columns the delimiter actually splits out. A semicolon
    // that splits every line into nine beats a comma that appears once inside a label.
    const score = (modalFrequency / counts.length) * 100 + Math.min(modal, 99);
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

function countSeparators(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted || character !== delimiter) continue;
    // A comma between two digits is a decimal comma, not a column separator.
    if (isDigit(line[index - 1]) && isDigit(line[index + 1])) continue;
    count += 1;
  }
  return count;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}
