import { describe, expect, it } from "vitest";

import type { ModelRouter } from "@getpaseo/protocol/model-router";
import { AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX } from "@getpaseo/protocol/open-weight-routers";
import {
  createOpenWeightRouterSync,
  type OpenWeightRouterSyncDeps,
} from "./open-weight-routers.js";
import type {
  ProviderSnapshotRecord,
  ProviderSnapshotTransition,
} from "./provider-snapshot-manager.js";
import { GLOBAL_PROVIDER_SNAPSHOT_KEY } from "./provider-snapshot-manager.js";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "./agent-sdk-types.js";

function entry(
  provider: string,
  label: string,
  models: AgentModelDefinition[],
  overrides: Partial<ProviderSnapshotEntry> = {},
): ProviderSnapshotEntry {
  return {
    provider,
    label,
    status: "ready",
    enabled: true,
    models,
    ...overrides,
  };
}

function model(provider: string, id: string, label: string): AgentModelDefinition {
  return { provider, id, label };
}

describe("createOpenWeightRouterSync", () => {
  function record(entryValue: ProviderSnapshotEntry): ProviderSnapshotRecord {
    return { entry: entryValue, contentHash: entryValue.provider };
  }

  function harness(initialEntries: ProviderSnapshotEntry[]) {
    let records = initialEntries.map(record);
    let cwd = GLOBAL_PROVIDER_SNAPSHOT_KEY;
    const listeners = new Set<(transition: ProviderSnapshotTransition) => void>();
    const patches: unknown[] = [];
    let currentConfig: {
      modelRouters?: { routers: ModelRouter[]; defaultRouterId?: string | null };
    } = { modelRouters: { routers: [], defaultRouterId: "manual-router" } };

    const snapshotManager = {
      on(_event: "change", listener: (transition: ProviderSnapshotTransition) => void) {
        listeners.add(listener);
        return snapshotManager;
      },
      off(_event: "change", listener: (transition: ProviderSnapshotTransition) => void) {
        listeners.delete(listener);
        return snapshotManager;
      },
      getSnapshot() {
        return { cwd, records };
      },
    };

    const store = {
      get: () => currentConfig,
      patch: (patch: unknown) => {
        patches.push(patch);
        const next = patch as {
          modelRouters: { routers: ModelRouter[]; defaultRouterId?: string | null };
        };
        currentConfig = {
          modelRouters: {
            routers: next.modelRouters.routers,
            ...(next.modelRouters.defaultRouterId !== undefined
              ? { defaultRouterId: next.modelRouters.defaultRouterId }
              : {}),
          },
        };
        return currentConfig;
      },
    };

    const publish = () => {
      const previous = { cwd, records: [] };
      const current = { cwd, records };
      for (const listener of listeners) listener({ previous, current });
    };

    const sync = createOpenWeightRouterSync({
      store: store as unknown as OpenWeightRouterSyncDeps["store"],
      snapshotManager: snapshotManager as unknown as OpenWeightRouterSyncDeps["snapshotManager"],
      logger: { info: () => {}, warn: () => {} },
      schedule: (run) => {
        run();
        return () => {};
      },
    });

    return {
      sync,
      patches,
      publish,
      getConfig: () => currentConfig,
      setEntries(next: ProviderSnapshotEntry[]) {
        records = next.map(record);
      },
      setCwd(next: string) {
        cwd = next;
      },
    };
  }

  const deepseek = entry("opencode", "OpenCode Free", [
    model("opencode", "deepseek-v4.1-flash:free", "DeepSeek V4.1 Flash"),
  ]);
  const deepseekPaid = entry("opencode-go", "OpenCode Go", [
    model("opencode-go", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash"),
  ]);

  it("waits for every enabled provider to settle before writing", () => {
    const h = harness([deepseek, deepseekPaid]);
    h.setEntries([deepseek, { ...deepseekPaid, status: "loading" }]);
    h.sync.start();
    expect(h.patches).toEqual([]);

    h.setEntries([deepseek, deepseekPaid]);
    h.publish();

    expect(h.patches).toHaveLength(1);
    expect(h.getConfig().modelRouters).toMatchObject({
      defaultRouterId: "manual-router",
      routers: [{ id: `${AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX}deepseek-v4.1-flash` }],
    });
  });

  it("does not rewrite unchanged routers and ignores workspace catalogues", () => {
    const h = harness([deepseek, deepseekPaid]);
    h.sync.start();
    expect(h.patches).toHaveLength(1);

    h.publish();
    expect(h.patches).toHaveLength(1);

    h.setCwd("C:\\workspace");
    h.publish();
    expect(h.patches).toHaveLength(1);
  });
});
