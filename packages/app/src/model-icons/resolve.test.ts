import { describe, expect, it } from "vitest";
import { MODEL_ICON_SVGS } from "@/model-icons/icons";
import {
  resolveChoiceIconId,
  resolveModelIconId,
  resolveRouterIconId,
} from "@/model-icons/resolve";

describe("resolveModelIconId", () => {
  it.each([
    ["claude-opus-4-5", "claude"],
    ["anthropic/claude-sonnet-4-5", "claude"],
    ["openai/gpt-4o", "openai"],
    ["gpt-5.1-codex", "openai"],
    ["o3-mini", "openai"],
    ["openai/gpt-oss-120b", "openai"],
    ["sora-2", "sora"],
    ["dall-e-3", "dalle"],
    ["gemini-2.5-pro", "gemini"],
    ["google/gemma-3-27b", "gemma"],
    ["x-ai/grok-4", "xai"],
    ["meta-llama/llama-3.3-70b", "meta"],
    ["deepseek/deepseek-v4-flash:free", "deepseek"],
    ["qwen/qwen3-coder", "qwen"],
    ["mistralai/mistral-large", "mistral"],
    ["moonshotai/kimi-k2", "kimi"],
    ["z-ai/glm-4.6", "zai"],
    ["cohere/command-r-plus", "cohere"],
    ["amazon/nova-pro-v1:0", "nova"],
    ["microsoft/phi-4", "microsoft"],
    ["nvidia/llama-3.1-nemotron-70b", "nvidia"],
    ["ace-step-v1", "ace"],
    ["step-3.5-flash", "stepfun"],
  ] as const)("maps %s to %s", (id, icon) => {
    expect(resolveModelIconId({ id })).toBe(icon);
  });

  it("reads the family from the label when the id is opaque", () => {
    expect(resolveModelIconId({ id: "ft:custom", label: "Claude Haiku" })).toBe("claude");
  });

  it("leaves an unrecognized model without a mark", () => {
    expect(resolveModelIconId({ id: "example-1", label: "Example" })).toBeNull();
    expect(resolveModelIconId({ id: "commandcode" })).toBeNull();
    expect(resolveModelIconId({ id: "graphite" })).toBeNull();
    expect(resolveModelIconId({ id: "" })).toBeNull();
  });

  it("keeps DeepSeek off the StepFun mark", () => {
    expect(resolveModelIconId({ id: "deepseek-v3" })).toBe("deepseek");
  });
});

describe("resolveRouterIconId", () => {
  it("uses a stored mark before the router name", () => {
    expect(
      resolveRouterIconId({
        icon: "claude",
        name: "DeepSeek V4 Flash",
        targets: [{ provider: "opencode", model: "qwen3" }],
      }),
    ).toBe("claude");
  });

  it("reads the mark from the router name", () => {
    expect(
      resolveRouterIconId({
        name: "DeepSeek V4 Flash",
        targets: [{ provider: "opencode", model: "custom-target" }],
      }),
    ).toBe("deepseek");
  });

  it("falls through to the first target that has a mark", () => {
    expect(
      resolveRouterIconId({
        name: "Premium Free",
        targets: [
          { provider: "opencode", model: "custom-target" },
          { provider: "openai", model: "gpt-4o" },
        ],
      }),
    ).toBe("openai");
  });

  it("ignores an icon id the catalog does not ship", () => {
    expect(
      resolveRouterIconId({
        icon: "not-a-real-icon",
        name: "Mine",
        targets: [{ provider: "opencode", model: null }],
      }),
    ).toBeNull();
  });
});

describe("resolveChoiceIconId", () => {
  it("prefers the router while one is selected", () => {
    expect(
      resolveChoiceIconId({
        modelId: "gpt-4o",
        router: {
          name: "Claude fallback",
          targets: [{ provider: "claude", model: "claude-haiku" }],
        },
      }),
    ).toBe("claude");
  });

  it("uses the selected model when no router is selected", () => {
    expect(resolveChoiceIconId({ modelId: "gemini-2.5-pro", router: null })).toBe("gemini");
  });
});

describe("model icon artwork", () => {
  it("ships a tintable svg for every catalog id", () => {
    for (const [id, svg] of Object.entries(MODEL_ICON_SVGS)) {
      expect(svg.startsWith("<svg"), id).toBe(true);
      expect(svg.includes("currentColor"), id).toBe(true);
    }
  });
});
