import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  createProviderCatalogRefreshScheduler,
  parseProviderCatalogRefreshInterval,
  PROVIDER_CATALOG_REFRESH_INTERVAL_MS,
  providerCatalogRefreshIntervalFromEnv,
} from "./provider-catalog-refresh-scheduler.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function schedulerHarness() {
  const ticks: Array<() => void> = [];
  const warmUpSnapshotForCwd = vi.fn(async () => {});
  const refreshSettingsSnapshot = vi.fn(async () => {});
  return {
    ticks,
    warmUpSnapshotForCwd,
    refreshSettingsSnapshot,
    schedule: (tick: () => void) => {
      ticks.push(tick);
      return () => {
        const index = ticks.indexOf(tick);
        if (index >= 0) ticks.splice(index, 1);
      };
    },
  };
}

describe("parseProviderCatalogRefreshInterval", () => {
  test("falls back to thirty minutes for missing and invalid values", () => {
    expect(parseProviderCatalogRefreshInterval(undefined)).toBe(
      PROVIDER_CATALOG_REFRESH_INTERVAL_MS,
    );
    expect(parseProviderCatalogRefreshInterval("")).toBe(PROVIDER_CATALOG_REFRESH_INTERVAL_MS);
    expect(parseProviderCatalogRefreshInterval("nope")).toBe(PROVIDER_CATALOG_REFRESH_INTERVAL_MS);
    expect(parseProviderCatalogRefreshInterval(-1)).toBe(PROVIDER_CATALOG_REFRESH_INTERVAL_MS);
    expect(parseProviderCatalogRefreshInterval(1.5)).toBe(PROVIDER_CATALOG_REFRESH_INTERVAL_MS);
  });

  test("accepts zero to disable the timer and positive millisecond values", () => {
    expect(parseProviderCatalogRefreshInterval(0)).toBe(0);
    expect(parseProviderCatalogRefreshInterval("90000")).toBe(90_000);
  });
});

describe("providerCatalogRefreshIntervalFromEnv", () => {
  test("reads the dedicated environment variable", () => {
    expect(
      providerCatalogRefreshIntervalFromEnv({
        PASEO_PROVIDER_CATALOG_REFRESH_INTERVAL_MS: "45000",
      } as NodeJS.ProcessEnv),
    ).toBe(45_000);
  });
});

describe("createProviderCatalogRefreshScheduler", () => {
  test("warms up once on start and refreshes on every scheduled tick", async () => {
    const harness = schedulerHarness();
    const scheduler = createProviderCatalogRefreshScheduler({
      manager: harness,
      logger: createTestLogger(),
      intervalMs: 1_000,
      schedule: harness.schedule,
    });

    scheduler.start();
    scheduler.start();
    expect(harness.warmUpSnapshotForCwd).toHaveBeenCalledTimes(1);
    expect(harness.warmUpSnapshotForCwd).toHaveBeenCalledWith({ markAutoRefreshAttempt: true });
    expect(harness.ticks).toHaveLength(1);

    harness.ticks[0]!();
    await flush();
    expect(harness.refreshSettingsSnapshot).toHaveBeenCalledWith({ keepLastGoodOnError: true });
  });

  test("does not overlap cycles", async () => {
    const gate = deferred();
    const harness = schedulerHarness();
    harness.refreshSettingsSnapshot.mockImplementation(() => gate.promise);
    const scheduler = createProviderCatalogRefreshScheduler({
      manager: harness,
      logger: createTestLogger(),
      intervalMs: 1_000,
      schedule: harness.schedule,
    });
    scheduler.start();

    harness.ticks[0]!();
    harness.ticks[0]!();
    expect(harness.refreshSettingsSnapshot).toHaveBeenCalledTimes(1);

    gate.resolve();
    await flush();
  });

  test("keeps scheduling after a failed cycle", async () => {
    const harness = schedulerHarness();
    harness.refreshSettingsSnapshot.mockRejectedValueOnce(new Error("boom"));
    const scheduler = createProviderCatalogRefreshScheduler({
      manager: harness,
      logger: createTestLogger(),
      intervalMs: 1_000,
      schedule: harness.schedule,
    });
    scheduler.start();

    harness.ticks[0]!();
    await flush();
    harness.ticks[0]!();
    await flush();
    expect(harness.refreshSettingsSnapshot).toHaveBeenCalledTimes(2);
  });

  test("stop clears the timer and zero disables it", () => {
    const harness = schedulerHarness();
    const scheduler = createProviderCatalogRefreshScheduler({
      manager: harness,
      logger: createTestLogger(),
      intervalMs: 1_000,
      schedule: harness.schedule,
    });
    scheduler.start();
    scheduler.stop();
    expect(harness.ticks).toHaveLength(0);

    const disabledHarness = schedulerHarness();
    const disabled = createProviderCatalogRefreshScheduler({
      manager: disabledHarness,
      logger: createTestLogger(),
      intervalMs: 0,
      schedule: disabledHarness.schedule,
    });
    disabled.start();
    expect(disabledHarness.warmUpSnapshotForCwd).toHaveBeenCalledTimes(1);
    expect(disabledHarness.ticks).toHaveLength(0);
  });
});
