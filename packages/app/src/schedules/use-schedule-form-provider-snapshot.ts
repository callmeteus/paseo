import { useEffect, useMemo } from "react";
import { disabledModelIdsByProviderFromConfig } from "@getpaseo/protocol/disabled-models";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { ScheduleFormModel, ScheduleFormState } from "./schedule-form-model";

export function useScheduleFormProviderSnapshot(
  model: ScheduleFormModel,
  state: ScheduleFormState,
) {
  const serverId = state.providerSnapshotRequest?.serverId ?? state.selectedServerId;
  const cwd = state.providerSnapshotRequest?.cwd ?? state.workingDir;
  const enabled = state.targetKind === "new-agent" && Boolean(serverId && cwd.trim());
  const snapshot = useProvidersSnapshot(serverId ?? null, {
    cwd,
    enabled,
  });
  const { config } = useDaemonConfig(serverId);
  const disabledModelIdsByProvider = useMemo(
    () => disabledModelIdsByProviderFromConfig(config?.providers),
    [config?.providers],
  );

  useEffect(() => {
    if (!enabled || !serverId || !snapshot.entries) {
      return;
    }
    model.applyProviderSnapshot(serverId, {
      entries: snapshot.entries,
      disabledModelIdsByProvider,
    });
  }, [disabledModelIdsByProvider, enabled, model, serverId, snapshot.entries]);

  return snapshot;
}
