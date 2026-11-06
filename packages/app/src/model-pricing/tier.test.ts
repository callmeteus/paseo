import { describe, expect, it } from "vitest";
import { formatPriceMarks, resolveModelPriceTier, summarizePriceTiers } from "@/model-pricing/tier";

describe("resolveModelPriceTier", () => {
  it("reads a published per-million rate", () => {
    expect(
      resolveModelPriceTier({ id: "custom", metadata: { cost: { input: 0, output: 0 } } }),
    ).toBe(0);
    expect(
      resolveModelPriceTier({ id: "custom", metadata: { cost: { input: 0.15, output: 0.6 } } }),
    ).toBe(2);
    expect(
      resolveModelPriceTier({ id: "custom", metadata: { cost: { input: 1, output: 5 } } }),
    ).toBe(3);
    expect(
      resolveModelPriceTier({ id: "custom", metadata: { cost: { input: 3, output: 15 } } }),
    ).toBe(4);
    expect(
      resolveModelPriceTier({ id: "custom", metadata: { cost: { input: 5, output: 25 } } }),
    ).toBe(5);
    expect(
      resolveModelPriceTier({ id: "custom", metadata: { cost: { input: 30, output: 180 } } }),
    ).toBe(5);
  });

  it("treats a published rate below one thousandth of a dollar as per token", () => {
    expect(
      resolveModelPriceTier({
        id: "custom",
        metadata: { cost: { input: 0.000005, output: 0.000025 } },
      }),
    ).toBe(5);
  });

  it("lets a published rate override the model name", () => {
    expect(
      resolveModelPriceTier({
        id: "claude-opus-4-7",
        label: "Opus 4.7",
        metadata: { cost: { input: 0.1, output: 0.5 } },
      }),
    ).toBe(2);
  });

  it("uses the published family rate when the catalog omits a price", () => {
    expect(resolveModelPriceTier({ id: "claude-fable-5", label: "Fable 5" })).toBe(5);
    expect(resolveModelPriceTier({ id: "claude-opus-4-7", label: "Opus 4.7" })).toBe(5);
    expect(resolveModelPriceTier({ id: "claude-sonnet-4-6", label: "Sonnet 4.6" })).toBe(4);
    expect(resolveModelPriceTier({ id: "claude-haiku-4-5", label: "Haiku 4.5" })).toBe(3);
    expect(resolveModelPriceTier({ id: "claude-haiku-5-5", label: "Haiku 5.5" })).toBe(2);
    expect(resolveModelPriceTier({ id: "gpt-5.4", label: "GPT-5.4" })).toBe(4);
    expect(resolveModelPriceTier({ id: "gpt-5.5", label: "GPT-5.5" })).toBe(5);
    expect(resolveModelPriceTier({ id: "gpt-5.5-pro", label: "GPT-5.5 Pro" })).toBe(5);
    expect(resolveModelPriceTier({ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" })).toBe(2);
    expect(resolveModelPriceTier({ id: "provider/model:free", label: "Model" })).toBe(0);
  });

  it("leaves a sized-down or unknown model without a mark", () => {
    expect(resolveModelPriceTier({ id: "gpt-5.4-mini", label: "GPT-5.4 mini" })).toBeNull();
    expect(resolveModelPriceTier({ id: "example-1", label: "Example" })).toBeNull();
    expect(resolveModelPriceTier({ id: "", label: "Default" })).toBeNull();
  });
});

describe("formatPriceMarks", () => {
  it("draws one mark per step and a span when the models differ", () => {
    expect(formatPriceMarks({ min: 4, max: 4 }, "Free")).toBe("$$$$");
    expect(formatPriceMarks({ min: 3, max: 5 }, "Free")).toBe("$$$–$$$$$");
    expect(formatPriceMarks({ min: 0, max: 0 }, "Free")).toBe("Free");
    expect(formatPriceMarks({ min: 0, max: 4 }, "Free")).toBe("Free–$$$$");
  });
});

describe("summarizePriceTiers", () => {
  it("ignores models with no rate", () => {
    expect(summarizePriceTiers([null, 2, undefined, 5])).toEqual({ min: 2, max: 5 });
    expect(summarizePriceTiers([null, undefined])).toBeNull();
  });
});
