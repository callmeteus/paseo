import { useCallback, useRef, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { Pencil, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type {
  WorkspaceLabelColor,
  WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";
import type { ControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import type { WorkspaceLabelManagerDraft } from "./internal/workflow-model";
import { WorkspaceLabelDot, WorkspaceLabelSwatchRow } from "./swatch";

/** The size the host pill's own glyphs use, so the row's trailing mark matches the controls above it. */
const EDIT_ICON_SIZE = 14;

/** Grows the pencil to a 44pt target without moving it off the trailing rail. */
const EDIT_HIT_SLOP = (44 - EDIT_ICON_SIZE) / 2;

const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Two presses inside this window count as a double click on the name. */
const DOUBLE_PRESS_MS = 350;

/**
 * One label: its colour, its name, and always-visible edit and delete actions.
 *
 * Double-pressing the name opens the same edit view as the pencil. Both actions stay mounted so a
 * row never changes shape under the pointer, and so touch users get the same affordance as web.
 */
export function WorkspaceLabelManagerRow({
  label,
  disabled,
  onEdit,
  onDelete,
}: {
  label: WorkspaceLabelDefinition;
  disabled: boolean;
  onEdit: (label: WorkspaceLabelDefinition) => void;
  onDelete: (label: WorkspaceLabelDefinition) => void;
}): ReactElement {
  const { t } = useTranslation();
  const lastPressAt = useRef(0);
  const edit = useCallback(() => onEdit(label), [label, onEdit]);
  const remove = useCallback(() => onDelete(label), [label, onDelete]);
  const handleNamePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressAt.current < DOUBLE_PRESS_MS) {
      lastPressAt.current = 0;
      onEdit(label);
      return;
    }
    lastPressAt.current = now;
  }, [label, onEdit]);
  const iconStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      managerStyles.rowIcon,
      pressed && managerStyles.rowIconPressed,
    ],
    [],
  );

  return (
    <View style={managerStyles.row} testID={`workspace-label-manager-label-${label.name}`}>
      <WorkspaceLabelDot color={label.color} />
      <Text
        style={managerStyles.rowName}
        numberOfLines={1}
        onPress={handleNamePress}
        testID={`workspace-label-manager-name-${label.name}`}
      >
        {label.name}
      </Text>
      <View style={managerStyles.rowActions}>
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={t("workspaceLabels.manage.editLabel", { name: label.name })}
          disabled={disabled}
          hitSlop={EDIT_HIT_SLOP}
          onPress={edit}
          style={iconStyle}
          testID={`workspace-label-manager-edit-${label.name}`}
        >
          <ThemedPencil size={EDIT_ICON_SIZE} uniProps={mutedMapping} />
        </PressHighlight>
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={t("workspaceLabels.manage.delete")}
          disabled={disabled}
          hitSlop={EDIT_HIT_SLOP}
          onPress={remove}
          style={iconStyle}
          testID={`workspace-label-manager-delete-${label.name}`}
        >
          <ThemedTrash size={EDIT_ICON_SIZE} uniProps={mutedMapping} />
        </PressHighlight>
      </View>
    </View>
  );
}

/**
 * A label's name and colour, changed together and committed once by Save.
 *
 * Picking a colour picks a colour — nothing leaves for the host until Save, so a failure has one
 * thing to report and the draft is still exactly what was typed.
 */
export function WorkspaceLabelEditView({
  draft,
  disabled,
  error,
  onChangeName,
  onChangeColor,
  onSubmit,
}: {
  draft: WorkspaceLabelManagerDraft;
  disabled: boolean;
  error: string | null;
  onChangeName: (value: string) => void;
  onChangeColor: (color: WorkspaceLabelColor) => void;
  onSubmit: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const size: ControlSize = useIsCompactFormFactor() ? "md" : "sm";
  return (
    <>
      <Field label={t("workspaceLabels.manage.name")}>
        <FormTextInput
          size={size}
          initialValue={draft.name}
          resetKey={draft.name}
          onChangeText={onChangeName}
          onSubmitEditing={onSubmit}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("workspaceLabels.manage.name")}
          testID="workspace-label-manager-name"
        />
      </Field>
      <Field label={t("workspaceLabels.manage.color")}>
        <WorkspaceLabelSwatchRow
          value={draft.color}
          onChange={onChangeColor}
          disabled={disabled}
          testID="workspace-label-manager-colors"
        />
      </Field>
      {error ? (
        <Text style={managerStyles.error} testID="workspace-label-manager-error">
          {error}
        </Text>
      ) : null}
    </>
  );
}

/** Text and action styles shared by the manager sheet and its settings-page counterpart. */
export const managerStyles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[1],
  },
  // The dot leads at the content inset and the two icons end on it; nothing here indents, so the
  // list holds one rail down its whole length.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  rowIcon: {
    // The glyph is the whole control — its 44pt target comes from hitSlop, which grows outward
    // and leaves the trailing rail where it is.
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconPressed: {
    opacity: 0.6,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  saveButton: {
    minWidth: 112,
  },
}));
