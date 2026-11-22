import { useCallback, useState, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { Pencil } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type {
  WorkspaceLabelColor,
  WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { WorkspaceLabelManagerDraft } from "./internal/workflow-model";
import { WorkspaceLabelDot, WorkspaceLabelSwatchRow } from "./swatch";

/** The size the host pill's own glyphs use, so the row's trailing mark matches the controls above it. */
const EDIT_ICON_SIZE = 14;

/** Grows the pencil to a 44pt target without moving it off the trailing rail. */
const EDIT_HIT_SLOP = (44 - EDIT_ICON_SIZE) / 2;

const ThemedPencil = withUnistyles(Pencil);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * One label: its colour, its name, and the pencil that opens it.
 *
 * Hover lives on the plain outer `View` and press on the inner `Pressable`, which is the one
 * shape that survives a pressable inside a hover target (docs/hover.md). The pencil fades rather
 * than mounts, so revealing it cannot move the row out from under the pointer.
 */
export function WorkspaceLabelManagerRow({
  label,
  disabled,
  onEdit,
}: {
  label: WorkspaceLabelDefinition;
  disabled: boolean;
  onEdit: (label: WorkspaceLabelDefinition) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const edit = useCallback(() => onEdit(label), [label, onEdit]);
  const revealed = isHovered || isNative || isCompact;
  const editStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      managerStyles.rowEdit,
      !revealed && managerStyles.rowEditHidden,
      pressed && managerStyles.rowEditPressed,
    ],
    [revealed],
  );

  return (
    <View
      style={managerStyles.row}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID={`workspace-label-manager-label-${label.name}`}
    >
      <WorkspaceLabelDot color={label.color} />
      <Text style={managerStyles.rowName} numberOfLines={1}>
        {label.name}
      </Text>
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={t("workspaceLabels.manage.editLabel", { name: label.name })}
        disabled={disabled}
        hitSlop={EDIT_HIT_SLOP}
        onPress={edit}
        pointerEvents={revealed ? "auto" : "none"}
        style={editStyle}
        testID={`workspace-label-manager-edit-${label.name}`}
      >
        <ThemedPencil size={EDIT_ICON_SIZE} uniProps={mutedMapping} />
      </PressHighlight>
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
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
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
  // Fixed height so the pencil appearing cannot resize the row under the pointer. The dot leads
  // at the content inset and the pencil ends on it; nothing here indents, so the list holds one
  // rail down its whole length.
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
  rowEdit: {
    // The glyph is the whole control — its 44pt target comes from hitSlop, which grows outward
    // and leaves the trailing rail where it is.
    alignItems: "center",
    justifyContent: "center",
  },
  rowEditHidden: {
    opacity: 0,
  },
  rowEditPressed: {
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
