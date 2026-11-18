import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { switchModelAndRetry } from "./switch-model-and-retry";

const client = {
  setAgentModel: vi.fn(),
  setAgentModelRouter: vi.fn(),
  sendAgentMessage: vi.fn(),
};

const serverId = "remote-host";
const agentId = "agent-1";
const draftKey = buildDraftStoreKey({ serverId, agentId });

beforeEach(() => {
  client.setAgentModel.mockReset().mockResolvedValue(undefined);
  client.setAgentModelRouter.mockReset().mockResolvedValue(undefined);
  client.sendAgentMessage.mockReset().mockResolvedValue(undefined);
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
