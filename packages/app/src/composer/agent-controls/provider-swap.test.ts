import { describe, expect, it, vi } from "vitest";
import { performAgentProviderSwap, ProviderSwapError } from "./provider-swap";

function createClient(result: { newAgentId?: string | null; error?: string | null }) {
  return {
    swapAgentProvider: vi.fn(async () => result),
  };
}

describe("performAgentProviderSwap", () => {
  it("swaps the provider, persists the preference, and returns the new agent id", async () => {
    const client = createClient({ newAgentId: "agent-new" });
    const persistPreference = vi.fn(async () => undefined);

    const result = await performAgentProviderSwap({
      client,
      agentId: "agent-old",
      provider: "codex",
      modelId: "gpt-5",
      persistPreference,
    });

    expect(client.swapAgentProvider).toHaveBeenCalledWith({
      agentId: "agent-old",
      targetProvider: "codex",
      targetModel: "gpt-5",
    });
    expect(persistPreference).toHaveBeenCalledWith("codex", "gpt-5");
    expect(result).toEqual({ newAgentId: "agent-new" });
  });

  it("passes a null target model when no model is selected", async () => {
    const client = createClient({ newAgentId: "agent-new" });

    await performAgentProviderSwap({
      client,
      agentId: "agent-old",
      provider: "codex",
      modelId: "",
      persistPreference: async () => undefined,
    });

    expect(client.swapAgentProvider).toHaveBeenCalledWith({
      agentId: "agent-old",
      targetProvider: "codex",
      targetModel: null,
    });
  });

  it("reports a daemon error without persisting preferences", async () => {
    const client = createClient({ error: "provider unavailable" });
    const persistPreference = vi.fn(async () => undefined);

    await expect(
      performAgentProviderSwap({
        client,
        agentId: "agent-old",
        provider: "codex",
        modelId: "gpt-5",
        persistPreference,
      }),
    ).rejects.toThrow(ProviderSwapError);
    expect(persistPreference).not.toHaveBeenCalled();
  });

  it("reports a missing new agent id", async () => {
    const client = createClient({ newAgentId: null });

    await expect(
      performAgentProviderSwap({
        client,
        agentId: "agent-old",
        provider: "codex",
        modelId: "gpt-5",
        persistPreference: async () => undefined,
      }),
    ).rejects.toThrow("Provider swap did not return a new agent");
  });

  it("keeps the swap when persisting the preference fails", async () => {
    const client = createClient({ newAgentId: "agent-new" });
    const onPreferencePersistError = vi.fn();

    const result = await performAgentProviderSwap({
      client,
      agentId: "agent-old",
      provider: "codex",
      modelId: "gpt-5",
      persistPreference: async () => {
        throw new Error("storage offline");
      },
      onPreferencePersistError,
    });

    expect(result).toEqual({ newAgentId: "agent-new" });
    expect(onPreferencePersistError).toHaveBeenCalledWith(expect.any(Error));
  });
});
