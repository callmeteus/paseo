import { useMemo } from "react";
import type { TextFilePreviewProps } from "../source/panel";
import { buildTableModel } from "./model";
import { parseDelimitedText } from "./parse-delimited";
import { TableSurface } from "./surface";

/**
 * Parsing is linear in the file's length, so a huge export gets its head read instead of the whole
 * file; the footer then reports a row count it knows to be a floor.
 */
const CHARACTER_BUDGET = 8_000_000;

/** A CSV, TSV or semicolon-separated file as a grid: the text panel's Preview. */
export function DelimitedTextPreview({ text }: TextFilePreviewProps) {
  const table = useMemo(() => {
    const truncated = text.length > CHARACTER_BUDGET;
    const parsed = parseDelimitedText(truncated ? text.slice(0, CHARACTER_BUDGET) : text);
    return buildTableModel({
      rows: parsed.rows,
      rowCount: truncated ? null : parsed.rowCount,
      columnCount: parsed.columnCount,
    });
  }, [text]);

  return <TableSurface table={table} />;
}
