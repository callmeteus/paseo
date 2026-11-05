import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TableGrid } from "./grid";
import { formatCount, type TableModel } from "./model";

/** A grid with the counts under it: the one surface both table panels draw. */
export function TableSurface({ table }: { table: TableModel }) {
  const { t } = useTranslation();
  if (table.rows.length === 0) {
    return <TableNotice message={t("panels.file.table.empty")} />;
  }
  return (
    <View style={styles.container} testID="table-surface">
      <TableGrid table={table} />
      <TableSummary table={table} />
    </View>
  );
}

export function TableNotice({ message }: { message: string }) {
  return (
    <View style={styles.centerState} testID="table-notice">
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

function TableSummary({ table }: { table: TableModel }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const { rowCount } = table;
  /** Records on screen, header included, so the counts and the truncation note agree. */
  const keptRecords = table.rows.length;

  const counts = [
    rowCount === null
      ? t("panels.file.table.rowsAtLeast", { rows: formatCount(keptRecords, locale) })
      : t("panels.file.table.rows", {
          count: rowCount,
          rows: formatCount(rowCount, locale),
        }),
    t("panels.file.table.columns", {
      count: table.columnCount,
      columns: formatCount(table.columnCount, locale),
    }),
  ].join(" · ");

  const truncations: string[] = [];
  if (table.rowsTruncated) {
    truncations.push(
      rowCount === null
        ? t("panels.file.table.showingRowsOnly", { shown: formatCount(keptRecords, locale) })
        : t("panels.file.table.showingRows", {
            shown: formatCount(keptRecords, locale),
            total: formatCount(rowCount, locale),
          }),
    );
  }
  if (table.columnsTruncated) {
    truncations.push(
      t("panels.file.table.showingColumns", {
        shown: formatCount(table.rows[0]?.length ?? 0, locale),
        total: formatCount(table.columnCount, locale),
      }),
    );
  }

  return (
    <View style={styles.summary}>
      <Text style={styles.counts} numberOfLines={1}>
        {counts}
      </Text>
      {truncations.length > 0 ? (
        <Text style={styles.truncation} numberOfLines={1}>
          {truncations.join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  noticeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  counts: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  truncation: {
    flexShrink: 1,
    textAlign: "right",
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize["2xs"],
  },
}));
