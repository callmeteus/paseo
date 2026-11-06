import { describe, expect, it } from "vitest";
import type { ModelRouter } from "@getpaseo/protocol/model-router";
import { pinRouterEntry, routerPickAsModel, takePinnedRouterEntry } from "./entry-target";

function router(overrides: Partial<ModelRouter> = {}): ModelRouter {
  return {
    id: "router_deepseek",
    name: "DeepSeek V4 Flash",
    mode: "fallback",
    targets: [
      { provider: "opencode", model: "deepseek-v4-flash" },
      { provider: "opencode", model: "deepseek-v4" },
    ],
    ...overrides,
  };
}

describe("routerPickAsModel", () => {
  it("stages a fallback router as its first model", () => {
    expect(
      routerPickAsModel({
        targetServerId: "srv_a",
        routerId: "router_deepseek",
        router: router(),
      }),
    ).toEqual({
      kind: "model",
      targetServerId: "srv_a",
      provider: "opencode",
      modelId: "deepseek-v4-flash",
      clearRouter: false,
      routerId: "router_deepseek",
    });
  });

  it("stages a distribution router as one of its targets", () => {
    const staged = routerPickAsModel({
      targetServerId: "srv_a",
      routerId: "router_deepseek",
      router: router({ mode: "distribution" }),
    });
    expect(["deepseek-v4-flash", "deepseek-v4"]).toContain(staged?.modelId);
    expect(staged?.routerId).toBe("router_deepseek");
  });
});

describe("takePinnedRouterEntry", () => {
  it("keeps the model the selector just showed, once", () => {
    pinRouterEntry("router_deepseek", "opencode", "deepseek-v4-flash");
    expect(takePinnedRouterEntry("router_deepseek", "opencode", "deepseek-v4-flash")).toBe(true);
    expect(takePinnedRouterEntry("router_deepseek", "opencode", "deepseek-v4-flash")).toBe(false);
  });

  it("does not keep a model the user did not just pick", () => {
    pinRouterEntry("router_deepseek", "opencode", "deepseek-v4-flash");
    expect(takePinnedRouterEntry("router_deepseek", "opencode", "beam-free")).toBe(false);
  });
});
