import { useCallback, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { HostFilter } from "@/components/hosts/host-filter";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  managerStyles,
  WorkspaceLabelEditView,
  WorkspaceLabelManagerRow,
} from "@/workspace-labels/manager-views";
import { useWorkspaceLabelManager } from "@/workspace-labels/use-label-manager";

/**
 * The App-side home for Paseo's label catalog: list the labels of a host and edit them in place.
 *
 * It shares the sheet's model and rows, so renaming, recolouring, deleting, host selection, and
 * offline handling behave identically wherever a label is managed. The edit form sits above the
 * list instead of behind a sheet header, so a settings page stays a page.
 */
export function LabelsSection(): ReactElement {
  const { t } = useTranslation();
  const { state, hosts, selectHost, edit, cancelEdit, setDraftName, setDraftColor, save, remove } =
    useWorkspaceLabelManager(true);
  const disabled = state.host?.status !== "online" || state.pending;
  const isEditing = state.draft !== null && state.editing !== null;
  const hostOptionTestID = useCallback(
    (serverId: string) => `settings-labels-host-${serverId}`,
    [],
  );

  return (
    <SettingsSection title={t("workspaceLabels.manage.title")} testID="settings-labels">
      {hosts.length > 1 ? (
        <HostFilter
          hosts={hosts}
          selectedHost={state.serverId}
          onSelectHost={selectHost}
          includeAllHost={false}
          triggerTestID="settings-labels-host"
          hostOptionTestID={hostOptionTestID}
        />
      ) : null}
      {isEditing && state.draft && state.editing ? (
        <View style={settingsStyles.card} testID="settings-labels-edit">
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowTitle}>
              {t("workspaceLabels.manage.editLabel", { name: state.editing.name })}
            </Text>
          </View>
          <View style={styles.form}>
            <WorkspaceLabelEditView
              draft={state.draft}
              disabled={disabled}
              error={state.error}
              onChangeName={setDraftName}
              onChangeColor={setDraftColor}
              onSubmit={save}
            />
          </View>
          <View style={styles.actions}>
            <Button
              variant="outline"
              size="md"
              onPress={cancelEdit}
              testID="settings-labels-cancel"
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={disabled}
              onPress={remove}
              testID="settings-labels-delete"
            >
              {t("workspaceLabels.manage.delete")}
            </Button>
            <Button
              size="md"
              style={styles.saveButton}
              disabled={disabled || !state.dirty}
              loading={state.pending}
              onPress={save}
              testID="settings-labels-save"
            >
              {t("workspaceLabels.manage.save")}
            </Button>
          </View>
        </View>
      ) : null}
      <View style={managerStyles.list}>
        {state.labels.map((label) => (
          <WorkspaceLabelManagerRow
            key={workspaceLabelKey(label.name)}
            label={label}
            disabled={disabled}
            onEdit={edit}
          />
        ))}
        {state.labels.length === 0 ? (
          <Text style={managerStyles.muted}>{t("workspaceLabels.manage.empty")}</Text>
        ) : null}
      </View>
      {state.host?.status === "offline" ? (
        <Text style={managerStyles.muted}>{t("workspaceLabels.manage.offline")}</Text>
      ) : null}
      {state.host?.status === "unsupported" ? (
        <Text style={managerStyles.muted}>{t("workspaceLabels.manage.updateHost")}</Text>
      ) : null}
      {(state.error ?? state.host?.error) ? (
        <Text style={managerStyles.error} testID="settings-labels-error">
          {state.error ?? state.host?.error}
        </Text>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  saveButton: {
    minWidth: 96,
  },
}));
