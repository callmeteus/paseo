import type { ModelRouter } from "@getpaseo/protocol/model-router";
import {
  buildOpenWeightRouters,
  mergeAutoOpenWeightRouters,
} from "@getpaseo/protocol/open-weight-routers";
import type { Logger } from "pino";

import type { DaemonConfigStore } from "../daemon-config-store.js";
import type {
  ProviderSnapshotManager,
  ProviderSnapshotRecord,
  ProviderSnapshotTransition,
} from "./provider-snapshot-manager.js";
import { GLOBAL_PROVIDER_SNAPSHOT_KEY } from "./provider-snapshot-manager.js";

const DEFAULT_SYNC_DEBOUNCE_MS = 200;

export interface OpenWeightRouterSyncDeps {
  store: Pick<DaemonConfigStore, "get" | "patch">;
  snapshotManager: Pick<ProviderSnapshotManager, "on" | "off" | "getSnapshot">;
  logger: Pick<Logger, "info" | "warn">;
  debounceMs?: number;
  /** Test seam; production uses an unref'd timeout. */
  schedule?: (run: () => void, delayMs: number) => () => void;
}

export interface OpenWeightRouterSync {
  start(): void;
  stop(): void;
  /** Runs immediately; returns whether the config changed. */
  syncNow(): boolean;
}

/**
 * Watches the global provider catalogue and keeps the automatic routers in the
 * daemon config. It waits until every enabled provider has settled so a partial
 * warmup cannot drop a router that is about to come back.
 */
export function createOpenWeightRouterSync(deps: OpenWeightRouterSyncDeps): OpenWeightRouterSync {
  const debounceMs = deps.debounceMs ?? DEFAULT_SYNC_DEBOUNCE_MS;
  const schedule = deps.schedule ?? defaultSchedule;
  let started = false;
  let cancelScheduled: (() => void) | null = null;

  const syncNow = (): boolean => {
    const snapshot = deps.snapshotManager.getSnapshot();
    if (!isSnapshotSettled(snapshot.records)) return false;

    const current = deps.store.get().modelRouters;
    const existing = current?.routers ?? [];
    const generated = buildOpenWeightRouters(snapshot.records.map(({ entry }) => entry));
    const next = mergeAutoOpenWeightRouters(existing, generated);
    if (sameRouters(existing, next)) return false;

    try {
      deps.store.patch({
        modelRouters: {
          routers: next,
          ...(current?.defaultRouterId !== undefined
            ? { defaultRouterId: current.defaultRouterId }
            : {}),
        },
      });
      deps.logger.info(
        { routers: generated.length },
        "Updated automatic open-weight model routers",
      );
      return true;
    } catch (error) {
      deps.logger.warn({ err: error }, "Failed to update automatic open-weight model routers");
      return false;
    }
  };

  const scheduleSync = (): void => {
    cancelScheduled?.();
    cancelScheduled = schedule(() => {
      cancelScheduled = null;
      syncNow();
    }, debounceMs);
  };

  const onChange = (transition: ProviderSnapshotTransition): void => {
    if (transition.current.cwd !== GLOBAL_PROVIDER_SNAPSHOT_KEY) return;
    if (!isSnapshotSettled(transition.current.records)) return;
    scheduleSync();
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      deps.snapshotManager.on("change", onChange);
      scheduleSync();
    },
    stop(): void {
      if (!started) return;
      started = false;
      cancelScheduled?.();
      cancelScheduled = null;
      deps.snapshotManager.off("change", onChange);
    },
    syncNow,
  };
}

function defaultSchedule(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

function isSnapshotSettled(records: readonly ProviderSnapshotRecord[]): boolean {
  return records.every(({ entry }) => !entry.enabled || entry.status !== "loading");
}

function sameRouters(left: readonly ModelRouter[], right: readonly ModelRouter[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
