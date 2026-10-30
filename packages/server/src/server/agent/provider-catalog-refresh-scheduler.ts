import type { Logger } from "pino";

import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";

export const PROVIDER_CATALOG_REFRESH_INTERVAL_MS = 30 * 60_000;
const PROVIDER_CATALOG_REFRESH_INTERVAL_ENV = "PASEO_PROVIDER_CATALOG_REFRESH_INTERVAL_MS";
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type SchedulerManager = Pick<
  ProviderSnapshotManager,
  "warmUpSnapshotForCwd" | "refreshSettingsSnapshot"
>;

export interface ProviderCatalogRefreshSchedulerOptions {
  manager: SchedulerManager;
  logger: Pick<Logger, "info" | "warn">;
  /** Milliseconds between cycles. 0 keeps the boot warmup but stops the timer. */
  intervalMs?: number;
  /** Test seam; production uses an unref'd interval. */
  schedule?: (tick: () => void, intervalMs: number) => () => void;
}

export interface ProviderCatalogRefreshScheduler {
  start(): void;
  stop(): void;
}

/**
 * Parses the catalog refresh interval. Invalid values fall back to 30 minutes;
 * 0 disables the periodic cycle.
 */
export function parseProviderCatalogRefreshInterval(value: unknown): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    return PROVIDER_CATALOG_REFRESH_INTERVAL_MS;
  }
  return Math.min(parsed, MAX_TIMER_DELAY_MS);
}

function defaultSchedule(tick: () => void, intervalMs: number): () => void {
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Keeps every provider catalogue fresh while the daemon runs: one warmup when the
 * daemon opens, then a forced refresh that reaches every known snapshot target.
 */
export function createProviderCatalogRefreshScheduler(
  options: ProviderCatalogRefreshSchedulerOptions,
): ProviderCatalogRefreshScheduler {
  const intervalMs = options.intervalMs ?? providerCatalogRefreshIntervalFromEnv();
  const schedule = options.schedule ?? defaultSchedule;
  let started = false;
  let running = false;
  let cancelTimer: (() => void) | null = null;

  const refresh = async (): Promise<void> => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      await options.manager.refreshSettingsSnapshot({ keepLastGoodOnError: true });
      options.logger.info(
        { elapsedMs: Date.now() - startedAt },
        "Provider catalogues refreshed automatically",
      );
    } catch (error) {
      options.logger.warn({ err: error }, "Automatic provider catalogue refresh failed");
    } finally {
      running = false;
    }
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      // Cold catalogue: this is what the first selector open would have triggered anyway.
      void options.manager
        .warmUpSnapshotForCwd({ markAutoRefreshAttempt: true })
        .catch((error) => options.logger.warn({ err: error }, "Provider catalogue warmup failed"));
      if (intervalMs <= 0) return;
      cancelTimer = schedule(() => {
        void refresh();
      }, intervalMs);
    },
    stop(): void {
      started = false;
      cancelTimer?.();
      cancelTimer = null;
    },
  };
}

export function providerCatalogRefreshIntervalFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseProviderCatalogRefreshInterval(env[PROVIDER_CATALOG_REFRESH_INTERVAL_ENV]);
}
