import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { commitPickedModelAndRetry, switchModelAndRetry } from "./switch-model-and-retry";

const client = {
  setAgentModel: vi.fn(),
  setAgentModelRouter: vi.fn(),
  sendAgentMessage: vi.fn(),
  swapAgentProvider: vi.fn(),
  archiveAgent: vi.fn(),
};

const serverId = "remote-host";
const agentId = "agent-1";
const draftKey = buildDraftStoreKey({ serverId, agentId });

beforeEach(() => {
  client.setAgentModel.mockReset().mockResolvedValue(undefined);
  client.setAgentModelRouter.mockReset().mockResolvedValue(undefined);
  client.sendAgentMessage.mockReset().mockResolvedValue(undefined);
  client.swapAgentProvider.mockReset().mockResolvedValue({
    newAgentId: "agent-2",
    previousAgentId: agentId,
  });
  client.archiveAgent.mockReset().mockResolvedValue(undefined);
  useDraftStore.setState({ drafts: {}, createModalDraft: null });
});

describe("switchModelAndRetry", () => {
  it("commits the picked model and re-sends the rejected prompt", async () => {
    useDraftStore
      .getState()
      .saveDraftInput({ draftKey, draft: { text: "faz deploy", attachments: [] } });

    await switchModelAndRetry({
      client: client as unknown as DaemonClient,
      serverId,
      agentId,
      modelId: "gpt-5.5",
      clearRouter: true,
    });

    expect(client.setAgentModel).toHaveBeenCalledWith(agentId, "gpt-5.5");
    expect(client.setAgentModelRouter).toHaveBeenCalledWith(agentId, null);
    expect(client.sendAgentMessage).toHaveBeenCalledWith(
      agentId,
      "faz deploy",
      expect.objectContaining({ messageId: expect.any(String) }),
    );
    expect(useDraftStore.getState().getDraftInput(draftKey)?.text).toBeUndefined();
  });

  it("does not send when no prompt was restored", async () => {
    await switchModelAndRetry({
      client: client as unknown as DaemonClient,
      serverId,
      agentId,
      modelId: "gpt-5.5",
      clearRouter: false,
    });

    expect(client.setAgentModel).toHaveBeenCalledWith(agentId, "gpt-5.5");
    expect(client.setAgentModelRouter).not.toHaveBeenCalled();
    expect(client.sendAgentMessage).not.toHaveBeenCalled();
  });
});

describe("commitPickedModelAndRetry", () => {
  it("re-sends on the same chat when the provider stays", async () => {
    useDraftStore
      .getState()
      .saveDraftInput({ draftKey, draft: { text: "faz deploy", attachments: [] } });
    const persistPreference = vi.fn(async () => undefined);
    const navigate = vi.fn();

    await commitPickedModelAndRetry({
      client: client as unknown as DaemonClient,
      serverId,
      agentId,
      provider: "opencode",
      modelId: "sonnet-5.5",
      currentProvider: "opencode",
      targetServerId: serverId,
      clearRouter: false,
      workspaceId: null,
      persistPreference,
      navigate,
    });

    expect(client.setAgentModel).toHaveBeenCalledWith(agentId, "sonnet-5.5");
    expect(client.swapAgentProvider).not.toHaveBeenCalled();
    expect(client.sendAgentMessage).toHaveBeenCalledWith(
      agentId,
      "faz deploy",
      expect.objectContaining({ messageId: expect.any(String) }),
    );
    expect(persistPreference).toHaveBeenCalledWith("opencode", "sonnet-5.5");
    expect(navigate).not.toHaveBeenCalled();
    expect(useDraftStore.getState().getDraftInput(draftKey)?.text).toBeUndefined();
  });

  it("ports to the picked provider and re-sends the rejected prompt there", async () => {
    useDraftStore
      .getState()
      .saveDraftInput({ draftKey, draft: { text: "faz deploy", attachments: [] } });
    const persistPreference = vi.fn(async () => undefined);
    const navigate = vi.fn();

    await commitPickedModelAndRetry({
      client: client as unknown as DaemonClient,
      serverId,
      agentId,
      provider: "claude",
      modelId: "sonnet-5.5",
      currentProvider: "opencode",
      targetServerId: serverId,
      clearRouter: true,
      workspaceId: "ws-1",
      persistPreference,
      navigate,
    });

    expect(client.swapAgentProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        targetProvider: "claude",
        targetModel: "sonnet-5.5",
        modelRouterId: null,
      }),
    );
    expect(client.sendAgentMessage).toHaveBeenCalledWith(
      "agent-2",
      "faz deploy",
      expect.objectContaining({ messageId: expect.any(String) }),
    );
    expect(navigate).toHaveBeenCalledWith({
      serverId,
      agentId: "agent-2",
      workspaceId: "ws-1",
    });
    expect(client.archiveAgent).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        migratedTo: expect.objectContaining({ agentId: "agent-2", provider: "claude" }),
      }),
    );
    expect(useDraftStore.getState().getDraftInput(draftKey)?.text).toBeUndefined();
  });

  it("keeps the source chat when the port fails", async () => {
    useDraftStore
      .getState()
      .saveDraftInput({ draftKey, draft: { text: "faz deploy", attachments: [] } });
    client.swapAgentProvider.mockResolvedValue({ error: "provider unavailable" });
    const navigate = vi.fn();

    await expect(
      commitPickedModelAndRetry({
        client: client as unknown as DaemonClient,
        serverId,
        agentId,
        provider: "claude",
        modelId: "sonnet-5.5",
        currentProvider: "opencode",
        targetServerId: serverId,
        clearRouter: false,
        workspaceId: null,
        persistPreference: async () => undefined,
        navigate,
      }),
    ).rejects.toThrow("provider unavailable");

    expect(client.sendAgentMessage).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(client.archiveAgent).not.toHaveBeenCalled();
    expect(useDraftStore.getState().getDraftInput(draftKey)?.text).toBe("faz deploy");
  });
});
