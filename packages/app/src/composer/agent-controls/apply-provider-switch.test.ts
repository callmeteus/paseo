import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getClient: () => null }),
}));

import { applyProviderSwitch } from "./apply-provider-switch";

function createClient(result: { newAgentId?: string | null; error?: string | null }) {
  return {
    swapAgentProvider: vi.fn(async () => result),
  } as unknown as DaemonClient;
}

describe("applyProviderSwitch", () => {
  it("swaps on the source host and returns that host for the triggering message", async () => {
    const client = createClient({ newAgentId: "agent-new" });
    const persistPreference = vi.fn(async () => undefined);

    const result = await applyProviderSwitch({
      sourceClient: client,
      sourceServerId: "srv_a",
      agentId: "agent-old",
      workspaceId: "ws_1",
      pending: { targetServerId: "srv_a", provider: "cline", modelId: "cline-pro" },
      persistPreference,
    });

    expect(result).toEqual({ client, serverId: "srv_a", agentId: "agent-new" });
    expect(persistPreference).toHaveBeenCalledWith("cline", "cline-pro");
  });

  it("throws and keeps the conversation in place when the daemon rejects the swap", async () => {
    const client = createClient({ error: "provider unavailable" });

    await expect(
      applyProviderSwitch({
        sourceClient: client,
        sourceServerId: "srv_a",
        agentId: "agent-old",
        workspaceId: null,
        pending: { targetServerId: "srv_a", provider: "cline", modelId: "" },
        persistPreference: async () => undefined,
      }),
    ).rejects.toThrow("provider unavailable");
  });
});
