import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { generateMessageId } from "@/types/stream";

/**
 * Commits a model pick made from a provider error card and re-sends the prompt the
 * provider rejected. The draft is the retry payload: the daemon dropped the failed
 * turn and restored its text there. A same-provider model change needs no port, so
 * `setAgentModel` is enough before the new prompt goes out.
 */
export async function switchModelAndRetry(input: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  modelId: string;
  clearRouter: boolean;
}): Promise<void> {
  const { client, serverId, agentId, modelId, clearRouter } = input;

  await client.setAgentModel(agentId, modelId);
  if (clearRouter) await client.setAgentModelRouter(agentId, null);

  const draftKey = buildDraftStoreKey({ serverId, agentId });
  const text = useDraftStore.getState().getDraftInput(draftKey)?.text;
  if (!text?.trim()) return;

  await client.sendAgentMessage(agentId, text, { messageId: generateMessageId() });
  useDraftStore.getState().clearDraftInput({ draftKey });
}
