import { describe, expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import {
  buildOpenWeightFreePreset,
  buildPremiumFreePreset,
  buildRouterPresets,
  describeRouterTarget,
} from "./presets";

function entry(
  provider: string,
  models: { id: string; label: string; metadata?: Record<string, unknown> }[],
): ProviderSnapshotEntry {
  return {
    provider,
    status: "ready",
    enabled: true,
    models: models.map((model) => ({
      provider,
      id: model.id,
      label: model.label,
      ...(model.metadata ? { metadata: model.metadata } : {}),
    })),
  } as ProviderSnapshotEntry;
}

const zeroCost = { cost: { input: 0, output: 0 } };

describe("router presets", () => {
  it("orders premium free targets by tier and keeps only closed-weight labs", () => {
    const preset = buildPremiumFreePreset([
      entry("opencode", [
        { id: "openrouter/qwen/qwen3-coder:free", label: "Qwen3 Coder (free)", metadata: zeroCost },
        {
          id: "openrouter/anthropic/claude-haiku:free",
          label: "Claude Haiku (free)",
          metadata: zeroCost,
        },
        { id: "openrouter/openai/gpt-5:free", label: "GPT-5 (free)", metadata: zeroCost },
        { id: "openrouter/anthropic/claude-opus-9", label: "Claude Opus 9" },
      ]),
    ]);

    expect(preset).not.toBeNull();
    expect(preset!.mode).toBe("fallback");
    expect(preset!.targets).toEqual([
      { provider: "opencode", model: "openrouter/openai/gpt-5:free" },
      { provider: "opencode", model: "openrouter/anthropic/claude-haiku:free" },
    ]);
  });

  it("keeps only open-weight models in the open weight preset", () => {
    const preset = buildOpenWeightFreePreset([
      entry("opencode", [
        { id: "openrouter/meta/llama-4:free", label: "Llama 4 (free)", metadata: zeroCost },
        { id: "openrouter/xiaomi/mimo-7b:free", label: "MiMo 7B (free)", metadata: zeroCost },
        {
          id: "openrouter/deepseek/deepseek-v4:free",
          label: "DeepSeek V4 (free)",
          metadata: zeroCost,
        },
        { id: "openrouter/openai/gpt-5:free", label: "GPT-5 (free)", metadata: zeroCost },
      ]),
    ]);

    expect(preset?.targets).toEqual([
      { provider: "opencode", model: "openrouter/deepseek/deepseek-v4:free" },
      { provider: "opencode", model: "openrouter/meta/llama-4:free" },
      { provider: "opencode", model: "openrouter/xiaomi/mimo-7b:free" },
    ]);
  });

  it("returns no presets when nothing installed qualifies", () => {
    expect(buildRouterPresets([entry("codex", [{ id: "gpt-5.6", label: "GPT-5.6" }])])).toEqual([]);
  });

  it("describes a target with and without a model", () => {
    expect(describeRouterTarget({ provider: "codex", model: "gpt-5.6" })).toBe("codex · gpt-5.6");
    expect(describeRouterTarget({ provider: "codex", model: null })).toBe("codex · padrão");
  });
});

it("caps preset targets at the schema limit", () => {
  const models = Array.from({ length: 40 }, (_, index) => ({
    id: `openrouter/vendor/model-${index}:free`,
    label: `Model ${index} (free)`,
    metadata: zeroCost,
  }));
  const preset = buildPremiumFreePreset([entry("opencode", models)]);
  expect(preset?.targets).toHaveLength(32);
});
