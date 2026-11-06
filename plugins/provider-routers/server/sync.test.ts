import { describe, expect, it } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { AUTO_PROVIDER_ROUTER_ID_PREFIX } from "@getpaseo/protocol/auto-provider-routers";
import type { ModelRouter, ModelRouterSettings } from "@getpaseo/protocol/model-router";
import { syncProviderRouters } from "./sync.js";

function entry(
  provider: string,
  label: string,
  models: AgentModelDefinition[],
): ProviderSnapshotEntry {
  return { provider, label, status: "ready", enabled: true, models };
}

function model(
  provider: string,
  id: string,
  label: string,
  metadata?: Record<string, unknown>,
): AgentModelDefinition {
  return { provider, id, label, metadata };
}

const FREE = { cost: { input: 0, output: 0 } };

function createHarness(
  entries: ProviderSnapshotEntry[],
  initial: ModelRouter[] = [],
): { api: PaseoApi; patchCount: () => number; routers: () => ModelRouter[] } {
  let settings: ModelRouterSettings = { routers: initial };
  let patchCount = 0;
  const config = (): unknown => ({ modelRouters: settings, providers: {} });
  const api = {
    providers: { waitForReady: async () => ({ requestId: "r", entries }) },
    config: {
      get: async () => ({ requestId: "r", config: config() }),
      patch: async (next: { modelRouters?: ModelRouterSettings }) => {
        patchCount += 1;
        if (next.modelRouters) settings = next.modelRouters;
        return { requestId: "r", config: config() };
      },
    },
  } as unknown as PaseoApi;
  return { api, patchCount: () => patchCount, routers: () => settings.routers };
}

describe("syncProviderRouters", () => {
  it("writes the generated routers and preserves user and daemon routers", async () => {
    const user: ModelRouter = {
      id: "manual",
      name: "Manual",
      mode: "fallback",
      targets: [{ provider: "codex", model: "gpt-5.6" }],
    };
    const daemon: ModelRouter = {
      id: "auto-open-weight:llama-4",
      name: "Llama 4",
      mode: "fallback",
      targets: [{ provider: "opencode", model: "llama-4:free" }],
    };
    const harness = createHarness(
      [
        entry("opencode", "OpenCode", [
          model("opencode", "gpt-5", "GPT-5", { cost: { input: 1, output: 1 } }),
          model("opencode", "gpt-5:free", "GPT-5 (free)", FREE),
        ]),
      ],
      [user, daemon],
    );

    const result = await syncProviderRouters(harness.api);

    expect(result.providers).toEqual(["opencode"]);
    const ids = harness.routers().map((router) => router.id);
    expect(ids).toContain("manual");
    expect(ids).toContain("auto-open-weight:llama-4");
    expect(ids).toContain(`${AUTO_PROVIDER_ROUTER_ID_PREFIX}opencode`);
    const distribution = harness
      .routers()
      .find((router) => router.id === `${AUTO_PROVIDER_ROUTER_ID_PREFIX}opencode`);
    expect(distribution?.targets).toEqual([
      { provider: "opencode", model: "gpt-5:free" },
      { provider: "opencode", model: "gpt-5" },
    ]);
  });

  it("skips the patch when the catalogue has not changed", async () => {
    const harness = createHarness([
      entry("opencode", "OpenCode", [model("opencode", "gpt-5:free", "GPT-5 (free)", FREE)]),
    ]);

    await syncProviderRouters(harness.api);
    expect(harness.patchCount()).toBe(1);

    await syncProviderRouters(harness.api);
    expect(harness.patchCount()).toBe(1);
  });
});
