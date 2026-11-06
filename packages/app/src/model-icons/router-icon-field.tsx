import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Route } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ComboboxItem } from "@/components/ui/combobox";
import { SelectField, type SelectFieldRenderOptionInput } from "@/components/ui/select-field";
import { ModelIconGlyph } from "@/model-icons/glyph";
import { MODEL_ICON_LABELS } from "@/model-icons/icons";
import { isModelIconId, listModelIcons, resolveRouterIconId } from "@/model-icons/resolve";
import { ICON_SIZE } from "@/styles/theme";

const AUTOMATIC_ICON = "";

interface RouterIconTarget {
  provider: string;
  model: string | null;
}

export function RouterIconField({
  icon,
  name,
  targets,
  disabled,
  onChange,
}: {
  icon: string | null;
  name: string;
  targets: readonly RouterIconTarget[];
  disabled?: boolean;
  onChange: (icon: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const selectedId = icon && isModelIconId(icon) ? icon : AUTOMATIC_ICON;
  const inferredId = useMemo(
    () =>
      resolveRouterIconId({
        name: name.trim() || "router",
        targets: targets
          .filter((target) => target.provider.length > 0)
          .map((target) => ({ provider: target.provider, model: target.model })),
      }),
    [name, targets],
  );
  const shownId = selectedId || inferredId;
  const options = useMemo(
    () => [
      {
        id: "automatic",
        value: AUTOMATIC_ICON,
        label: t("settings.modelRouters.iconAutomatic"),
      },
      ...listModelIcons().map((choice) => ({
        id: choice.id,
        value: choice.id,
        label: choice.label,
      })),
    ],
    [t],
  );
  const selectedDisplay = useMemo(
    () => ({
      label: selectedId ? MODEL_ICON_LABELS[selectedId] : t("settings.modelRouters.iconAutomatic"),
    }),
    [selectedId, t],
  );
  const triggerLeading = useMemo(
    () =>
      shownId ? (
        <ModelIconGlyph id={shownId} size={ICON_SIZE.md} color={styles.icon.color} />
      ) : (
        <Route size={ICON_SIZE.md} color={styles.icon.color} />
      ),
    [shownId],
  );
  const handleChange = useCallback(
    (value: string) => {
      onChange(isModelIconId(value) ? value : null);
    },
    [onChange],
  );
  const renderOption = useCallback(
    ({ option, selected, active, onPress }: SelectFieldRenderOptionInput<string>) => (
      <RouterIconOption
        optionId={option.value}
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
      />
    ),
    [],
  );

  return (
    <SelectField
      label={t("settings.modelRouters.icon")}
      value={selectedId}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleChange}
      placeholder={t("settings.modelRouters.iconAutomatic")}
      emptyText={t("settings.modelRouters.iconEmpty")}
      searchable
      searchPlaceholder={t("settings.modelRouters.iconSearch")}
      disabled={disabled}
      size="sm"
      triggerLeading={triggerLeading}
      renderOption={renderOption}
      testID="router-icon-field"
      triggerTestID="router-icon-trigger"
    />
  );
}

function RouterIconOption({
  optionId,
  label,
  selected,
  active,
  onPress,
}: {
  optionId: string;
  label: string;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const leadingSlot = useMemo(() => {
    if (isModelIconId(optionId)) {
      return <ModelIconGlyph id={optionId} size={ICON_SIZE.md} color={styles.icon.color} />;
    }
    return <Route size={ICON_SIZE.md} color={styles.icon.color} />;
  }, [optionId]);
  return (
    <ComboboxItem
      label={label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
      testID={`router-icon-option-${optionId || "automatic"}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  icon: {
    color: theme.colors.foregroundMuted,
  },
}));
