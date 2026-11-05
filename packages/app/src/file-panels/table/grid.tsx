import { useCallback, useMemo, useState } from "react";
import { FlatList, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  columnLetter,
  looksNumeric,
  TABLE_COLUMN_LIMIT,
  tableBodyRows,
  tableHeaderLabels,
  type TableModel,
} from "./model";

const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 32;
const GUTTER_WIDTH = 52;
const MIN_COLUMN_WIDTH = 76;
const MAX_COLUMN_WIDTH = 320;
const CELL_HORIZONTAL_PADDING = 20;
/** Rough advance of one character at `fontSize.sm` in the UI font. */
const CHARACTER_WIDTH = 6.7;

/**
 * A spreadsheet's grid: a sticky header row over virtualized body rows, with a row-number gutter.
 * The table scrolls sideways as one piece and the first row stays put vertically, which is the
 * part of a spreadsheet reader a grid cannot drop.
 */
export function TableGrid({ table }: { table: TableModel }) {
  const labels = useMemo(() => tableHeaderLabels(table), [table]);
  const rows = useMemo(() => tableBodyRows(table), [table]);
  const widths = useMemo(() => columnWidths(table, labels, rows), [labels, rows, table]);
  const totalWidth = useMemo(
    () => GUTTER_WIDTH + widths.reduce((sum, width) => sum + width, 0),
    [widths],
  );
  // The list sits inside a horizontal ScrollView, whose content has no height of its own on web.
  // Measuring the viewport gives it one, so the virtualized list fills the panel on every platform.
  const [height, setHeight] = useState(0);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
    [],
  );
  const listStyle = useMemo(
    () => ({ width: totalWidth, height, flexGrow: 0 }),
    [height, totalWidth],
  );
  const header = useMemo(
    () => <TableHeaderRow labels={labels} widths={widths} />,
    [labels, widths],
  );
  const firstRowNumber = table.hasHeader ? 2 : 1;

  const renderRow = useCallback(
    ({ item, index }: { item: readonly string[]; index: number }) => (
      <TableBodyRow
        row={item}
        widths={widths}
        rowNumber={firstRowNumber + index}
        striped={index % 2 === 1}
      />
    ),
    [firstRowNumber, widths],
  );

  return (
    <View style={styles.viewport} onLayout={handleLayout}>
      <ScrollView
        horizontal
        style={styles.horizontal}
        showsHorizontalScrollIndicator
        testID="table-grid"
      >
        <FlatList
          data={rows}
          style={listStyle}
          keyExtractor={rowKey}
          renderItem={renderRow}
          ListHeaderComponent={header}
          stickyHeaderIndices={[0]}
          initialNumToRender={24}
          maxToRenderPerBatch={24}
          windowSize={9}
        />
      </ScrollView>
    </View>
  );
}

/** Rows are positional: the same record moves when the file is edited, so the index is the key. */
function rowKey(_row: readonly string[], index: number): string {
  return String(index);
}

function TableHeaderRow({
  labels,
  widths,
}: {
  labels: readonly string[];
  widths: readonly number[];
}) {
  return (
    <View style={[styles.row, styles.headerRow]}>
      <View style={[styles.gutter, styles.headerCell, styles.gutterColumn]} />
      {labels.map((label, index) => (
        <View key={columnLetter(index)} style={[styles.headerCell, { width: widths[index] }]}>
          <Text numberOfLines={1} style={styles.headerText}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TableBodyRow({
  row,
  widths,
  rowNumber,
  striped,
}: {
  row: readonly string[];
  widths: readonly number[];
  rowNumber: number;
  striped: boolean;
}) {
  return (
    <View style={[styles.row, styles.bodyRow, striped && styles.stripedRow]}>
      <View style={[styles.gutter, styles.bodyCell, styles.gutterColumn]}>
        <Text style={styles.gutterText}>{rowNumber}</Text>
      </View>
      {row.map((cell, index) => (
        <View key={columnLetter(index)} style={[styles.bodyCell, { width: widths[index] }]}>
          <Text
            selectable
            numberOfLines={1}
            accessibilityLabel={cell}
            style={looksNumeric(cell) ? styles.numericCell : styles.cellText}
          >
            {cell}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One width per column, from the header and the first rows the reader sees. A minimum keeps a
 * one-word column from disappearing and a maximum keeps a pasted paragraph from pushing every
 * other column off screen; a cell past either bound is clipped, not wrapped.
 */
function columnWidths(
  table: TableModel,
  labels: readonly string[],
  rows: readonly (readonly string[])[],
): number[] {
  const sample = rows.slice(0, 40);
  return Array.from({ length: Math.min(table.columnCount, TABLE_COLUMN_LIMIT) }, (_, column) => {
    let longest = labels[column]?.length ?? 0;
    for (const row of sample) {
      const length = row[column]?.length ?? 0;
      if (length > longest) longest = length;
    }
    const width = Math.round(longest * CHARACTER_WIDTH) + CELL_HORIZONTAL_PADDING;
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
  });
}

const styles = StyleSheet.create((theme) => ({
  viewport: { flex: 1, minHeight: 0 },
  horizontal: { flex: 1, minHeight: 0 },
  row: { flexDirection: "row", alignItems: "stretch" },
  bodyRow: { height: ROW_HEIGHT },
  headerRow: {
    height: HEADER_HEIGHT,
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  stripedRow: { backgroundColor: theme.colors.surface1 },
  gutter: {
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  gutterColumn: { width: GUTTER_WIDTH },
  headerCell: {
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  headerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  bodyCell: {
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  cellText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  numericCell: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  gutterText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize["2xs"],
    fontVariant: ["tabular-nums"],
  },
}));
