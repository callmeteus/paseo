import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { createControlGeometry, type ButtonControlSize } from "@/components/ui/control-geometry";
import { useContainedControlSize } from "@/components/ui/control-size";
import { settingsStyles } from "@/styles/settings";
import {
  SYSTEM_FONT_OPTION_ID,
  buildFontFamilyOptions,
  fontFamilyLabel,
  type FontSuggestion,
} from "@/appearance/font-families";

interface FontFamilyFieldProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  value: string;
  suggestions: readonly FontSuggestion[];
  withBorder: boolean;
  onCommit: (value: string) => void;
}

function FontFamilyOption({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const labelStyle = useMemo(
    () => (option.id === SYSTEM_FONT_OPTION_ID ? undefined : { fontFamily: option.id }),
    [option.id],
  );
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      labelStyle={labelStyle}
    />
  );
}

function sizeStyle(size: ButtonControlSize) {
  if (size === "xs") return styles.xs;
  if (size === "md" || size === "lg") return styles.md;
  return styles.sm;
}

export function FontFamilyField({
  title,
  hint,
  accessibilityLabel,
  value,
  suggestions,
  withBorder,
  onCommit,
}: FontFamilyFieldProps): ReactElement {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const containedSize = useContainedControlSize();
  const size = containedSize ?? "sm";
  const systemLabel = t("settings.appearance.fonts.systemDefault");
  const options = useMemo(
    () => buildFontFamilyOptions({ value, suggestions, systemLabel }),
    [suggestions, systemLabel, value],
  );
  const selectedLabel = fontFamilyLabel(value, suggestions, systemLabel);
  const triggerFontFamily = value.length > 0 ? value : undefined;

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);
  const handleSelect = useCallback(
    (id: string) => {
      onCommit(id === SYSTEM_FONT_OPTION_ID ? "" : id);
    },
    [onCommit],
  );
  const triggerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.trigger,
      sizeStyle(size),
      pressed ? styles.pressed : null,
    ],
    [size],
  );
  const labelStyle = useMemo(
    () => [styles.label, size === "xs" && styles.labelXs, { fontFamily: triggerFontFamily }],
    [size, triggerFontFamily],
  );
  const renderOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <FontFamilyOption option={option} selected={selected} active={active} onPress={onPress} />
    ),
    [],
  );

  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View ref={anchorRef} collapsable={false} style={styles.anchor}>
        <ComboboxTrigger
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={handleOpen}
          style={triggerStyle}
        >
          <Text numberOfLines={1} style={labelStyle}>
            {selectedLabel}
          </Text>
        </ComboboxTrigger>
      </View>
      <Combobox
        anchorRef={anchorRef}
        open={open}
        onOpenChange={setOpen}
        options={options}
        value={value.length === 0 ? SYSTEM_FONT_OPTION_ID : value}
        onSelect={handleSelect}
        searchable
        allowCustomValue
        customValuePrefix=""
        searchPlaceholder={t("settings.appearance.fonts.searchPlaceholder")}
        title={title}
        desktopMinWidth={240}
        renderOption={renderOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);
  return {
    rowWithBorder: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: theme.spacing[4],
      paddingHorizontal: theme.spacing[4],
      borderTopWidth: theme.borderWidth[1],
      borderTopColor: theme.colors.border,
    },
    anchor: {
      flexShrink: 1,
      maxWidth: 280,
    },
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      borderWidth: 1,
      borderColor: theme.colors.borderAccent,
      backgroundColor: "transparent",
    },
    xs: geometry.buttonXs,
    sm: geometry.buttonSm,
    md: geometry.buttonMd,
    pressed: {
      opacity: 0.85,
    },
    label: {
      flexShrink: 1,
      color: theme.colors.foreground,
      ...geometry.buttonText,
    },
    labelXs: geometry.buttonTextXs,
  };
});
