import { describe, expect, it } from "vitest";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "./agent-types.js";
import {
  AUTO_PROVIDER_ROUTER_ID_PREFIX,
  buildProviderRouters,
  mergeAutoProviderRouters,
} from "./auto-provider-routers.js";
import type { ModelRouter } from "./model-router.js";
import { hiddenSearchModelKeys } from "./model-router.js";

function entry(
  provider: string,
  label: string,
  models: AgentModelDefinition[],
  overrides: Partial<ProviderSnapshotEntry> = {},
): ProviderSnapshotEntry {
  return { provider, label, status: "ready", enabled: true, models, ...overrides };
}

function model(
  provider: string,
  id: string,
  label: string,
  metadata?: Record<string, unknown>,
  overrides: Partial<AgentModelDefinition> = {},
): AgentModelDefinition {
  return { provider, id, label, metadata, ...overrides };
}

const PAID = { cost: { input: 1, output: 2 } };
const FREE = { cost: { input: 0, output: 0 } };

describe("buildProviderRouters", () => {
  it("orders each provider's targets free first", () => {
    const [distribution] = buildProviderRouters([
      entry("opencode", "OpenCode", [
        model("opencode", "gpt-5", "GPT-5", PAID),
        model("opencode", "gpt-5:free", "GPT-5 (free)", FREE),
      ]),
    ]);

    expect(distribution!.id).toBe(`${AUTO_PROVIDER_ROUTER_ID_PREFIX}opencode`);
    expect(distribution!.mode).toBe("distribution");
    expect(distribution!.targets).toEqual([
      { provider: "opencode", model: "gpt-5:free" },
      { provider: "opencode", model: "gpt-5" },
    ]);
  });

  it("adds a free-first fallback router per model across providers", () => {
    const routers = buildProviderRouters([
      entry("codex", "Codex", [
        model("codex", "deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", PAID),
      ]),
      entry("opencode", "OpenCode Free", [
        model("opencode", "deepseek-v4-flash:free", "DeepSeek V4 Flash (free)"),
      ]),
    ]);

    const grouped = routers.find(
      (router) => router.id === `${AUTO_PROVIDER_ROUTER_ID_PREFIX}model:deepseek-v4-flash`,
    );
    expect(grouped?.mode).toBe("fallback");
    expect(grouped?.targets).toEqual([
      { provider: "opencode", model: "deepseek-v4-flash:free" },
      { provider: "codex", model: "deepseek/deepseek-v4-flash" },
    ]);
    // The cross-provider rows duplicate the router, so they leave general search.
    expect(grouped?.hideModelsInSearch).toBe(true);
  });

  it("hides only the models its per-model routers cover", () => {
    const routers = buildProviderRouters([
      entry("codex", "Codex", [
        model("codex", "deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", PAID),
      ]),
      entry("opencode", "OpenCode Free", [
        model("opencode", "deepseek-v4-flash:free", "DeepSeek V4 Flash (free)"),
      ]),
    ]);

    expect([...hiddenSearchModelKeys(routers)].sort()).toEqual([
      "codex::deepseek/deepseek-v4-flash",
      "opencode::deepseek-v4-flash:free",
    ]);
    // Distribution routers keep their provider's models searchable.
    expect(
      routers.find((router) => router.id.startsWith(`${AUTO_PROVIDER_ROUTER_ID_PREFIX}codex`))
        ?.hideModelsInSearch,
    ).toBeUndefined();
  });

  it("includes the open-weight and premium free presets", () => {
    const routers = buildProviderRouters([
      entry("opencode", "OpenCode", [
        model("opencode", "deepseek-v4-flash:free", "DeepSeek V4 Flash (free)", FREE),
        model("opencode", "gpt-5:free", "GPT-5 (free)", FREE),
      ]),
    ]);

    const openWeight = routers.find(
      (router) => router.id === `${AUTO_PROVIDER_ROUTER_ID_PREFIX}open-weight-free`,
    );
    expect(openWeight?.mode).toBe("fallback");
    expect(openWeight?.targets).toEqual([
      { provider: "opencode", model: "deepseek-v4-flash:free" },
    ]);

    const premium = routers.find(
      (router) => router.id === `${AUTO_PROVIDER_ROUTER_ID_PREFIX}premium-free`,
    );
    expect(premium?.targets).toEqual([{ provider: "opencode", model: "gpt-5:free" }]);
  });

  it("skips disabled providers, disabled models, and non-ready catalogues", () => {
    const routers = buildProviderRouters(
      [
        entry("disabled", "Disabled", [model("disabled", "gpt-5", "GPT-5")], { enabled: false }),
        entry("loading", "Loading", [model("loading", "gpt-5", "GPT-5")], { status: "loading" }),
        entry("hidden", "Hidden", [
          model("hidden", "gpt-5", "GPT-5", undefined, { isSelectable: false }),
        ]),
      ],
      { hidden: ["gpt-5"] },
    );

    expect(routers).toEqual([]);
  });
});

describe("mergeAutoProviderRouters", () => {
  it("preserves other routers and replaces the previous automatic set", () => {
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
    const stale: ModelRouter = {
      id: `${AUTO_PROVIDER_ROUTER_ID_PREFIX}old`,
      name: "Old",
      mode: "distribution",
      targets: [{ provider: "codex", model: "gpt-5.6" }],
    };
    const fresh: ModelRouter = {
      id: `${AUTO_PROVIDER_ROUTER_ID_PREFIX}new`,
      name: "New",
      mode: "distribution",
      targets: [{ provider: "opencode", model: "gpt-5:free" }],
    };

    expect(mergeAutoProviderRouters([user, daemon, stale], [fresh])).toEqual([user, daemon, fresh]);
  });
});
