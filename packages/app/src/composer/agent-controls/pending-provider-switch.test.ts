import { describe, expect, it } from "vitest";
import {
  clearProviderSwitch,
  getProviderSwitch,
  requiresProviderPort,
  resolveDisplayModelId,
  resolveDisplayProvider,
  resolveDisplayRouterId,
  resolveStagedRouterTarget,
  stageProviderSwitch,
  takeProviderSwitch,
} from "./pending-provider-switch";

describe("requiresProviderPort", () => {
  it("treats the same provider on the same host as a plain model change", () => {
    expect(
      requiresProviderPort({
        currentProvider: "opencode",
        currentServerId: "srv_a",
        nextProvider: "opencode",
        nextServerId: "srv_a",
      }),
    ).toBe(false);
  });

  it("requires a port when the provider changes", () => {
    expect(
      requiresProviderPort({
        currentProvider: "opencode",
        currentServerId: "srv_a",
        nextProvider: "cline",
        nextServerId: "srv_a",
      }),
    ).toBe(true);
  });

  it("requires a port when only the host changes", () => {
    expect(
      requiresProviderPort({
        currentProvider: "opencode",
        currentServerId: "srv_a",
        nextProvider: "opencode",
        nextServerId: "srv_b",
      }),
    ).toBe(true);
  });

  it("defaults an omitted target host to the current host", () => {
    expect(
      requiresProviderPort({
        currentProvider: "opencode",
        currentServerId: "srv_a",
        nextProvider: "opencode",
        nextServerId: null,
      }),
    ).toBe(false);
  });
});

describe("pending provider switch store", () => {
  it("stages a pick without committing it", () => {
    stageProviderSwitch("srv_a", "agent_1", {
      kind: "model",
      targetServerId: "srv_a",
      provider: "cline",
      modelId: "cline-pro",
      clearRouter: false,
    });

    expect(getProviderSwitch("srv_a", "agent_1")).toEqual({
      kind: "model",
      targetServerId: "srv_a",
      provider: "cline",
      modelId: "cline-pro",
      clearRouter: false,
    });
  });

  it("clears the staged pick when the user reverts to the current provider", () => {
    stageProviderSwitch("srv_a", "agent_1", {
      kind: "model",
      targetServerId: "srv_a",
      provider: "cline",
      modelId: "cline-pro",
      clearRouter: false,
    });

    clearProviderSwitch("srv_a", "agent_1");

    expect(getProviderSwitch("srv_a", "agent_1")).toBeNull();
  });

  it("takes the pick exactly once so one message commits one port", () => {
    stageProviderSwitch("srv_a", "agent_1", {
      kind: "model",
      targetServerId: "srv_b",
      provider: "kilo",
      modelId: "kilo-max",
      clearRouter: false,
    });

    expect(takeProviderSwitch("srv_a", "agent_1")).toEqual({
      kind: "model",
      targetServerId: "srv_b",
      provider: "kilo",
      modelId: "kilo-max",
      clearRouter: false,
    });
    expect(takeProviderSwitch("srv_a", "agent_1")).toBeNull();
  });

  it("keeps staged picks isolated per agent", () => {
    stageProviderSwitch("srv_a", "agent_1", {
      kind: "model",
      targetServerId: "srv_a",
      provider: "cline",
      modelId: "cline-pro",
      clearRouter: false,
    });

    expect(getProviderSwitch("srv_a", "agent_2")).toBeNull();
  });
});

describe("staged router display", () => {
  const fallbackRouter = {
    id: "router_fallback",
    name: "Fallback",
    mode: "fallback" as const,
    targets: [
      { provider: "opencode", model: "deepseek-v4" },
      { provider: "kilo", model: "kilo-max" },
    ],
  };
  const distributionRouter = {
    id: "router_distribution",
    name: "Distribution",
    mode: "distribution" as const,
    targets: [
      { provider: "opencode", model: "deepseek-v4" },
      { provider: "kilo", model: "kilo-max" },
    ],
  };
  const routers = [fallbackRouter, distributionRouter];

  it("resolves a fallback router to its first target", () => {
    const pending = {
      kind: "router" as const,
      targetServerId: "srv_a",
      routerId: "router_fallback",
    };

    expect(resolveStagedRouterTarget(pending, routers)).toEqual({
      provider: "opencode",
      model: "deepseek-v4",
    });
  });

  it("does not resolve a distribution router, which binds without changing the model", () => {
    const pending = {
      kind: "router" as const,
      targetServerId: "srv_a",
      routerId: "router_distribution",
    };

    expect(resolveStagedRouterTarget(pending, routers)).toBeNull();
  });

  it("returns null for a non-router pending target or an unknown router", () => {
    const modelPending = {
      kind: "model" as const,
      targetServerId: "srv_a",
      provider: "opencode",
      modelId: "deepseek-v4",
      clearRouter: false,
    };
    const unknownPending = {
      kind: "router" as const,
      targetServerId: "srv_a",
      routerId: "missing",
    };

    expect(resolveStagedRouterTarget(modelPending, routers)).toBeNull();
    expect(resolveStagedRouterTarget(unknownPending, routers)).toBeNull();
    expect(resolveStagedRouterTarget(null, routers)).toBeNull();
  });

  it("shows the router's target model and provider while a fallback router is staged", () => {
    const pending = {
      kind: "router" as const,
      targetServerId: "srv_a",
      routerId: "router_fallback",
    };
    const target = resolveStagedRouterTarget(pending, routers);

    expect(resolveDisplayProvider(pending, "cline", target)).toBe("opencode");
    expect(resolveDisplayModelId(pending, "cline-pro", target)).toBe("deepseek-v4");
  });

  it("keeps the running model when a distribution router is staged", () => {
    const pending = {
      kind: "router" as const,
      targetServerId: "srv_a",
      routerId: "router_distribution",
    };
    const target = resolveStagedRouterTarget(pending, routers);

    expect(resolveDisplayProvider(pending, "cline", target)).toBe("cline");
    expect(resolveDisplayModelId(pending, "cline-pro", target)).toBe("cline-pro");
  });
});

describe("router pick display", () => {
  const staged = {
    kind: "model" as const,
    targetServerId: "srv_a",
    provider: "opencode",
    modelId: "deepseek-v4-flash",
    clearRouter: false,
    routerId: "router_deepseek",
  };

  it("shows the router's model instead of the model that was already selected", () => {
    expect(resolveDisplayModelId(staged, "beam-free")).toBe("deepseek-v4-flash");
    expect(resolveDisplayProvider(staged, "opencode")).toBe("opencode");
    expect(resolveDisplayRouterId(staged, null)).toBe("router_deepseek");
  });

  it("keeps a router-only stage from changing the model", () => {
    expect(
      resolveDisplayModelId(
        { kind: "router", targetServerId: "srv_a", routerId: "router_deepseek" },
        "beam-free",
      ),
    ).toBe("beam-free");
  });
});
