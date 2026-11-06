import { describe, expect, it } from "vitest";

import type { AgentModelDefinition, ProviderSnapshotEntry } from "./agent-types.js";
import type { ModelRouter } from "./model-router.js";
import {
  AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX,
  buildModelFallbackRouters,
  buildOpenWeightRouters,
  mergeAutoOpenWeightRouters,
} from "./open-weight-routers.js";

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

describe("buildOpenWeightRouters", () => {
  it("puts every free target before paid ones and names the router after the model", () => {
    const routers = buildOpenWeightRouters([
      entry("opencode-go", "OpenCode Go", [
        model("opencode-go", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash", PAID),
      ]),
      entry("commandcode", "CommandCode", [
        model("commandcode", "deepseek/deepseek-v4.1-flash:free", "DeepSeek V4.1 Flash", FREE),
      ]),
      entry("opencode", "OpenCode Free", [
        model("opencode", "deepseek-v4.1-flash:free", "DeepSeek V4.1 Flash (free)", FREE),
      ]),
    ]);

    expect(routers).toEqual([
      {
        id: `${AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX}deepseek-v4.1-flash`,
        name: "DeepSeek V4.1 Flash",
        summary: "CommandCode → OpenCode Free → OpenCode Go",
        mode: "fallback",
        targets: [
          { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash:free" },
          { provider: "opencode", model: "deepseek-v4.1-flash:free" },
          { provider: "opencode-go", model: "deepseek-v4.1-flash" },
        ],
      },
    ]);
  });

  it("prefers a plain model label over a provider-prefixed catalog label", () => {
    const routers = buildOpenWeightRouters([
      entry("kilo", "Kilo", [
        model(
          "kilo",
          "kilo/deepseek/deepseek-v4-flash",
          "Kilo Gateway/DeepSeek: DeepSeek V4 Flash 0423",
          PAID,
        ),
      ]),
      entry("cline", "Cline", [
        model("cline", "deepseek/deepseek-v4-flash:free", "DeepSeek V4 Flash 0423", FREE),
      ]),
    ]);

    expect(routers[0]!.name).toBe("DeepSeek V4 Flash 0423");
  });

  it("groups a -free model id with its paid counterpart", () => {
    const routers = buildOpenWeightRouters([
      entry("opencode-go", "OpenCode Go", [
        model("opencode-go", "opencode-go/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", PAID),
      ]),
      entry("opencode", "OpenCode", [
        model("opencode", "opencode/deepseek-v4.1-flash-free", "DeepSeek V4.1 Flash", FREE),
      ]),
    ]);

    expect(routers).toHaveLength(1);
    expect(routers[0]!.id).toBe(`${AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX}deepseek-v4.1-flash`);
    expect(routers[0]!.targets).toEqual([
      { provider: "opencode", model: "opencode/deepseek-v4.1-flash-free" },
      { provider: "opencode-go", model: "opencode-go/deepseek-v4.1-flash" },
    ]);
  });

  it("treats every model from a provider named free as free even without cost metadata", () => {
    const routers = buildOpenWeightRouters([
      entry("opencode-go", "OpenCode Go", [
        model("opencode-go", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash", PAID),
      ]),
      entry("opencode-free", "OpenCode Free", [
        model("opencode-free", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash"),
      ]),
    ]);

    expect(routers[0]!.targets).toEqual([
      { provider: "opencode-free", model: "deepseek-v4.1-flash" },
      { provider: "opencode-go", model: "deepseek-v4.1-flash" },
    ]);
  });

  it("skips closed-weight models, single-target models, disabled providers, and loading catalogues", () => {
    const routers = buildOpenWeightRouters([
      entry("codex", "Codex", [model("codex", "gpt-5.6", "GPT-5.6", PAID)]),
      entry("opencode", "OpenCode", [model("opencode", "qwen3-coder", "Qwen3 Coder")]),
      entry("disabled", "Disabled", [model("disabled", "llama-4", "Llama 4")], {
        enabled: false,
      }),
      entry("loading", "Loading", [model("loading", "mistral-large", "Mistral Large")], {
        status: "loading",
      }),
      entry("hidden", "Hidden", [
        model("hidden", "gemma-4", "Gemma 4", undefined, { isSelectable: false }),
      ]),
    ]);

    expect(routers).toEqual([]);
  });

  it("groups the same model across providers and keeps the free tier of one provider as a target", () => {
    const routers = buildOpenWeightRouters([
      entry("opencode", "OpenCode", [
        model("opencode", "qwen3-coder:free", "Qwen3 Coder (free)", FREE),
        model("opencode", "qwen3-coder", "Qwen3 Coder", PAID),
      ]),
    ]);

    expect(routers).toHaveLength(1);
    expect(routers[0]!.targets).toEqual([
      { provider: "opencode", model: "qwen3-coder:free" },
      { provider: "opencode", model: "qwen3-coder" },
    ]);
    expect(routers[0]!.summary).toBe("OpenCode · Qwen3 Coder → Qwen3 Coder");
  });
});

describe("buildModelFallbackRouters", () => {
  it("groups any model across providers when include matches everything", () => {
    const routers = buildModelFallbackRouters(
      [
        entry("codex", "Codex", [model("codex", "gpt-5.6", "GPT-5.6", PAID)]),
        entry("copilot", "Copilot", [model("copilot", "gpt-5.6:free", "GPT-5.6 (free)", FREE)]),
      ],
      { idPrefix: "auto-provider:model:", include: () => true },
    );

    expect(routers).toEqual([
      {
        id: "auto-provider:model:gpt-5.6",
        name: "GPT-5.6",
        summary: "Copilot → Codex",
        mode: "fallback",
        targets: [
          { provider: "copilot", model: "gpt-5.6:free" },
          { provider: "codex", model: "gpt-5.6" },
        ],
      },
    ]);
  });

  it("honours the include predicate", () => {
    const routers = buildModelFallbackRouters(
      [
        entry("a", "A", [model("a", "llama-4", "Llama 4")]),
        entry("b", "B", [model("b", "llama-4", "Llama 4")]),
      ],
      { idPrefix: "x:", include: () => false },
    );

    expect(routers).toEqual([]);
  });
});

describe("mergeAutoOpenWeightRouters", () => {
  it("keeps user routers and replaces the previous automatic set", () => {
    const user: ModelRouter = {
      id: "manual-router",
      name: "Manual",
      mode: "fallback",
      targets: [{ provider: "codex", model: "gpt-5.6" }],
    };
    const staleAuto: ModelRouter = {
      id: `${AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX}old-model`,
      name: "Old",
      mode: "fallback",
      targets: [{ provider: "opencode", model: "old-model" }],
    };
    const fresh: ModelRouter = {
      id: `${AUTO_OPEN_WEIGHT_ROUTER_ID_PREFIX}deepseek-v4.1-flash`,
      name: "DeepSeek V4.1 Flash",
      mode: "fallback",
      targets: [
        { provider: "opencode", model: "deepseek-v4.1-flash:free" },
        { provider: "opencode-go", model: "deepseek-v4.1-flash" },
      ],
    };

    expect(mergeAutoOpenWeightRouters([user, staleAuto], [fresh])).toEqual([user, fresh]);
  });
});
