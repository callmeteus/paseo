import { useFileBytes, type PluginFile } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { FilePanelLoading } from "../loading";
import { readWorkbook, type WorkbookPreview } from "./read-workbook";
import { TableNotice, TableSurface } from "./surface";

/** Reading a workbook holds the file in memory more than once; past this the panel declines. */
const WORKBOOK_SIZE_LIMIT = 20 * 1024 * 1024;

/**
 * An XLSX, XLSM, XLS or ODS file as a grid. These are binary, so the panel reads the bytes and
 * parses them here; it has no Source view to switch to.
 */
export function WorkbookPreviewPanel({ file }: { file: PluginFile }) {
  const { t } = useTranslation();
  if (file.size > WORKBOOK_SIZE_LIMIT) {
    return <TableNotice message={t("panels.file.table.tooLarge")} />;
  }
  return <WorkbookReader file={file} />;
}

type WorkbookState =
  | { status: "reading" }
  | { status: "ready"; preview: WorkbookPreview }
  | { status: "failed" };

function WorkbookReader({ file }: { file: PluginFile }) {
  const { t } = useTranslation();
  const bytes = useFileBytes(file);
  // `useFileBytes` hands back a new wrapper object each render; the array itself is the version.
  const loadedBytes = bytes.status === "ready" ? bytes.bytes : null;
  const [state, setState] = useState<WorkbookState>({ status: "reading" });
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    if (!loadedBytes) return;
    let active = true;
    setState({ status: "reading" });
    void (async () => {
      try {
        const preview = await readWorkbook(loadedBytes);
        if (!active) return;
        setActiveSheet(0);
        setState({ status: "ready", preview });
      } catch {
        if (active) setState({ status: "failed" });
      }
    })();
    return () => {
      active = false;
    };
  }, [loadedBytes]);

  if (bytes.status === "loading") return <FilePanelLoading />;
  if (bytes.status === "error" || state.status === "failed") {
    return <TableNotice message={t("panels.file.table.unreadable")} />;
  }
  if (state.status === "reading") return <FilePanelLoading />;

  const { preview } = state;
  const sheetIndex = Math.min(activeSheet, preview.sheets.length - 1);
  const sheet = preview.sheets[sheetIndex];
  if (!sheet) return <TableNotice message={t("panels.file.table.empty")} />;

  return (
    <View style={styles.container} testID="workbook-preview">
      {preview.sheets.length > 1 ? (
        <SheetTabs
          sheets={preview.sheets.map((entry) => entry.name)}
          activeIndex={sheetIndex}
          onSelect={setActiveSheet}
        />
      ) : null}
      <TableSurface table={sheet.table} />
    </View>
  );
}

function SheetTabs({
  sheets,
  activeIndex,
  onSelect,
}: {
  sheets: readonly string[];
  activeIndex: number;
  onSelect(index: number): void;
}) {
  const { t } = useTranslation();
  const handlers = useMemo(
    () => sheets.map((_, index) => () => onSelect(index)),
    [onSelect, sheets],
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabs}
      contentContainerStyle={styles.tabsContent}
      accessibilityLabel={t("panels.file.table.sheetTabs")}
      testID="workbook-sheet-tabs"
    >
      {sheets.map((name, index) => (
        <SheetTab
          key={name}
          name={name}
          selected={index === activeIndex}
          onSelect={handlers[index]}
        />
      ))}
    </ScrollView>
  );
}

function SheetTab({
  name,
  selected,
  onSelect,
}: {
  name: string;
  selected: boolean;
  onSelect(): void;
}) {
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <PressHighlight
      onPress={onSelect}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      highlightStyle={styles.tabHighlight}
      style={selected ? styles.tabSelected : styles.tab}
    >
      <Text numberOfLines={1} style={selected ? styles.tabTextSelected : styles.tabText}>
        {name}
      </Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => {
  const tab = {
    maxWidth: 180,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  } as const;
  const tabText = { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm } as const;
  return {
    container: { flex: 1, minHeight: 0 },
    tabs: {
      flexGrow: 0,
      flexShrink: 0,
      borderBottomWidth: theme.borderWidth[1],
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface0,
    },
    tabsContent: {
      alignItems: "center",
      gap: theme.spacing[1],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
    },
    tab,
    tabSelected: { ...tab, backgroundColor: theme.colors.surface2 },
    tabHighlight: { backgroundColor: theme.colors.interactionHighlight },
    tabText,
    tabTextSelected: { ...tabText, color: theme.colors.foreground, fontWeight: "500" },
  };
});
