import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { HostFilter } from "@/components/hosts/host-filter";
import { Button } from "@/components/ui/button";
import { managerStyles, WorkspaceLabelEditView, WorkspaceLabelManagerRow } from "./manager-views";
import { useWorkspaceLabelManager } from "./use-label-manager";

/**
 * The whole label catalog of one host, and editing any one of them.
 *
 * Two views, one sheet: the list, and the edit view the pencil opens. The edit view is reached
 * the way every other sheet reaches a second page — the header's back arrow returns from it —
 * because a label row is a label, not a button that swaps the surface under you.
 */
export function WorkspaceLabelManagerModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const {
    state,
    hosts,
    selectHost,
    setQuery,
    edit,
    cancelEdit,
    setDraftName,
    setDraftColor,
    save,
    remove,
  } = useWorkspaceLabelManager(visible);
  const draft = state.draft;
  const editing = state.editing;
  const disabled = state.host?.status !== "online" || state.pending;

  const isEditing = draft !== null;
  // Search belongs to the sheet's header, where it spans the header's own rails and needs no
  // layout from this caller. `resetKey` empties the uncontrolled field on the same event that
  // clears the model's query, so the box and the list never disagree about what is filtered.
  const header = useMemo<SheetHeader>(
    () =>
      isEditing
        ? {
            title: t("workspaceLabels.manage.edit"),
            back: { onPress: cancelEdit },
          }
        : {
            title: t("workspaceLabels.manage.title"),
            search: {
              onChange: setQuery,
              resetKey: Number(visible),
              placeholder: t("workspaceLabels.manage.search"),
              testID: "workspace-label-manager-search",
            },
          },
    [cancelEdit, isEditing, setQuery, t, visible],
  );
  const footer = useMemo(
    () =>
      isEditing ? (
        <View style={managerStyles.footer}>
          <Button
            // Red belongs to the confirm dialog, not to the surface that opens it — docs/design.md.
            variant="outline"
            disabled={disabled}
            onPress={remove}
            testID="workspace-label-manager-delete"
          >
            {t("workspaceLabels.manage.delete")}
          </Button>
          <Button
            size="md"
            style={managerStyles.saveButton}
            disabled={disabled || !state.dirty}
            loading={state.pending}
            onPress={save}
            testID="workspace-label-manager-save"
          >
            {t("workspaceLabels.manage.save")}
          </Button>
        </View>
      ) : undefined,
    [disabled, isEditing, remove, save, state.dirty, state.pending, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      footer={footer}
      testID="workspace-label-manager"
    >
      {draft && editing ? (
        <WorkspaceLabelEditView
          draft={draft}
          disabled={disabled}
          error={state.error}
          onChangeName={setDraftName}
          onChangeColor={setDraftColor}
          onSubmit={save}
        />
      ) : (
        <>
          {hosts.length > 1 ? (
            <HostFilter
              hosts={hosts}
              selectedHost={state.serverId}
              onSelectHost={selectHost}
              includeAllHost={false}
              hang
              triggerTestID="workspace-label-manager-host"
              hostOptionTestID={managerHostOptionTestID}
            />
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
            <Text style={managerStyles.error} testID="workspace-label-manager-error">
              {state.error ?? state.host?.error}
            </Text>
          ) : null}
        </>
      )}
    </AdaptiveModalSheet>
  );
}

const managerHostOptionTestID = (serverId: string) => `workspace-label-manager-host-${serverId}`;
