import { usesDesktopBindings } from "@/keyboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { ScrollView } from "@/components/ui/scroll-view";
import { StyleSheet } from "react-native-unistyles";
import { CommandPanel } from "@/components/ui/command-panel";
import { Shortcut } from "@/components/ui/shortcut";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import {
  buildEffectiveBindings,
  buildKeyboardShortcutHelpSections,
} from "@/keyboard/keyboard-shortcuts";
import { filterShortcutHelpSections } from "@/keyboard/shortcut-help-search";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";

export function KeyboardShortcutsDialog() {
  const { t } = useTranslation();
  const open = useKeyboardShortcutsStore((s) => s.shortcutsDialogOpen);
  const setOpen = useKeyboardShortcutsStore((s) => s.setShortcutsDialogOpen);
  const [query, setQuery] = useState("");

  const shortcutOs = getShortcutOs();
  const isMac = shortcutOs === "mac";
  const { overrides } = useKeyboardShortcutOverrides();
  // Effective bindings, so a shortcut the user unassigned lists no keys here
  // instead of advertising a default that no longer fires.
  const bindings = useMemo(() => buildEffectiveBindings(overrides), [overrides]);
  const sections = useMemo(
    () => buildKeyboardShortcutHelpSections({ isMac, usesDesktopBindings }, bindings),
    [bindings, isMac],
  );
  const visibleSections = useMemo(
    () => filterShortcutHelpSections({ sections, query, translate: t, shortcutOs }),
    [query, sections, shortcutOs, t],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);
  const search = useMemo(
    () => ({
      onChangeText: setQuery,
      resetKey: Number(open),
      placeholder: t("settings.shortcuts.searchPlaceholder"),
      autoFocus: true,
    }),
    [open, t],
  );

  return (
    <CommandPanel
      title={t("settings.shortcuts.dialogTitle")}
      visible={open}
      onClose={handleClose}
      testID="keyboard-shortcuts-dialog"
      fill
      search={search}
    >
      <ScrollView
        testID="keyboard-shortcuts-dialog-content"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {visibleSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{t(section.titleKey)}</Text>
            <View>
              {section.rows.map((row) => (
                <View key={row.id} style={styles.row} testID={`shortcut-help-row-${row.id}`}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{t(row.labelKey)}</Text>
                    {row.note ? (
                      <Text style={styles.rowNote}>{row.noteKey ? t(row.noteKey) : row.note}</Text>
                    ) : null}
                  </View>
                  {row.chord === null ? (
                    <Text style={styles.rowUnassigned}>{t("settings.shortcuts.unassigned")}</Text>
                  ) : (
                    <Shortcut chord={row.chord} style={styles.rowShortcut} />
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}
        {visibleSections.length === 0 ? (
          <Text style={styles.empty}>{t("common.empty.noResults")}</Text>
        ) : null}
      </ScrollView>
    </CommandPanel>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    paddingBottom: theme.spacing[2],
  },
  section: {
    paddingTop: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    minHeight: 56,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  rowNote: {
    marginTop: 2,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  rowShortcut: {
    alignSelf: "flex-start",
  },
  // Matches the settings row's unassigned label, so the two screens describe the
  // same state the same way.
  rowUnassigned: {
    alignSelf: "flex-start",
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  empty: {
    paddingVertical: theme.spacing[6],
    textAlign: "center",
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
}));
