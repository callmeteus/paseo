import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getClient: () => null }),
}));

import { applyProviderSwitch } from "./apply-provider-switch";

function createClient(result: {
  newAgentId?: string | null;
  previousAgentId?: string | null;
  error?: string | null;
}) {
  return {
    swapAgentProvider: vi.fn(async () => result),
    archiveAgent: vi.fn(async () => undefined),
  } as unknown as DaemonClient;
}

describe("applyProviderSwitch", () => {
  it("swaps on the source host and archives it only when finalized", async () => {
    const client = createClient({ newAgentId: "agent-new", previousAgentId: "agent-old" });
    const persistPreference = vi.fn(async () => undefined);

    const result = await applyProviderSwitch({
      sourceClient: client,
      sourceServerId: "srv_a",
      agentId: "agent-old",
      workspaceId: "ws_1",
      pending: {
        kind: "model",
        targetServerId: "srv_a",
        provider: "cline",
        modelId: "cline-pro",
        clearRouter: false,
      },
      persistPreference,
    });

    expect(result.client).toBe(client);
    expect(result.serverId).toBe("srv_a");
    expect(result.agentId).toBe("agent-new");
    expect(client.archiveAgent).not.toHaveBeenCalled();
    expect(persistPreference).toHaveBeenCalledWith("cline", "cline-pro");

    await result.finalize();

    expect(client.archiveAgent).toHaveBeenCalledWith("agent-old", {
      migratedTo: expect.objectContaining({
        provider: "cline",
        agentId: "agent-new",
        host: "srv_a",
      }),
    });
  });

  it("throws and keeps the conversation in place when the daemon rejects the swap", async () => {
    const client = createClient({ error: "provider unavailable" });

    await expect(
      applyProviderSwitch({
        sourceClient: client,
        sourceServerId: "srv_a",
        agentId: "agent-old",
        workspaceId: null,
        pending: {
          kind: "model",
          targetServerId: "srv_a",
          provider: "cline",
          modelId: "",
          clearRouter: false,
        },
        persistPreference: async () => undefined,
      }),
    ).rejects.toThrow("provider unavailable");
    expect(client.archiveAgent).not.toHaveBeenCalled();
  });
});
