import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type {
  WorkspaceLabelColor,
  WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";
import { useHosts } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  createWorkspaceLabelManagerModel,
  useWorkspaceLabelProjection,
  workspaceLabels,
} from "@/workspace-labels";

/**
 * The one wiring behind both label-manager surfaces: the sidebar sheet and the App settings page.
 *
 * The model owns every transition, so a surface only supplies when it is active and renders the
 * snapshot. Sharing this keeps the settings page and the sheet from drifting on host selection,
 * search, save, or delete.
 */
export function useWorkspaceLabelManager(active: boolean) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { hosts: labelHosts } = useWorkspaceLabelProjection();
  const snapshots = useMemo(
    () => Object.fromEntries(labelHosts.map((host) => [host.serverId, host])),
    [labelHosts],
  );
  const [model] = useState(() =>
    createWorkspaceLabelManagerModel({
      update: (input) => workspaceLabels.update(input),
      inspectDelete: (input) => workspaceLabels.inspectDelete(input),
      delete: (input) => workspaceLabels.delete(input),
    }),
  );

  useEffect(() => {
    // Closing ends the edit, so reopening lands on the list rather than on whatever was half
    // typed a session ago. The settings page is always active and keeps its draft until it leaves.
    if (!active) {
      model.reset();
      return;
    }
    model.syncHosts(
      hosts.map((host) => ({
        serverId: host.serverId,
        label: host.label || host.serverId,
        status: snapshots[host.serverId]?.status ?? "offline",
        labels: snapshots[host.serverId]?.labels ?? [],
        error: snapshots[host.serverId]?.error,
      })),
    );
  }, [active, hosts, model, snapshots]);

  const state = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);

  const selectHost = useCallback((serverId: string) => model.selectHost(serverId), [model]);
  const setQuery = useCallback((value: string) => model.setQuery(value), [model]);
  const edit = useCallback((label: WorkspaceLabelDefinition) => model.edit(label), [model]);
  const cancelEdit = useCallback(() => model.cancelEdit(), [model]);
  const setDraftName = useCallback((value: string) => model.setDraftName(value), [model]);
  const setDraftColor = useCallback(
    (color: WorkspaceLabelColor) => model.setDraftColor(color),
    [model],
  );
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const confirmRemove = useCallback(
    (name: string) => (affected: number) =>
      confirmDialog({
        title: t("workspaceLabels.manage.deleteTitle", { name }),
        message: t("workspaceLabels.manage.deleteMessage", { count: affected }),
        confirmLabel: t("workspaceLabels.manage.delete"),
        destructive: true,
      }),
    [t],
  );
  const remove = useCallback((): void => {
    const editing = state.editing;
    if (!editing) return;
    void model.delete(confirmRemove(editing.name));
  }, [confirmRemove, model, state.editing]);
  const removeLabel = useCallback(
    (label: WorkspaceLabelDefinition): void => {
      void model.delete(confirmRemove(label.name), label);
    },
    [confirmRemove, model],
  );

  return {
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
    removeLabel,
  };
}
