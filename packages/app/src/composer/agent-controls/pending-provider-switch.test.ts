import { describe, expect, it } from "vitest";
import {
  clearProviderSwitch,
  getProviderSwitch,
  requiresProviderPort,
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
