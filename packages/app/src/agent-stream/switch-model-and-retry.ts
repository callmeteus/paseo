import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { applyProviderSwitch } from "@/composer/agent-controls/apply-provider-switch";
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
  /** Binds the chat to this router. Takes precedence over `clearRouter`. */
  routerId?: string | null;
}): Promise<void> {
  const { client, serverId, agentId, modelId, clearRouter, routerId } = input;

  await client.setAgentModel(agentId, modelId);
  if (routerId !== undefined) {
    await client.setAgentModelRouter(agentId, routerId);
  } else if (clearRouter) {
    await client.setAgentModelRouter(agentId, null);
  }

  await sendRestoredDraft({
    client,
    agentId,
    draftServerId: serverId,
    draftAgentId: agentId,
  });
}

/**
 * Commits the model the user just picked from a provider error card and re-sends
 * the rejected prompt. A different provider ports the chat first; the prompt is
 * sent to the destination, then the source is archived.
 */
export async function commitPickedModelAndRetry(input: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  provider: string;
  modelId: string;
  currentProvider: string | null | undefined;
  targetServerId: string;
  clearRouter: boolean;
  routerId?: string | null;
  workspaceId: string | null;
  persistPreference: (provider: string, modelId: string) => Promise<unknown>;
  navigate: (target: { serverId: string; agentId: string; workspaceId?: string }) => void;
}): Promise<void> {
  const targetHost = input.targetServerId.trim() || input.serverId;
  const sameChat = targetHost === input.serverId && input.provider === input.currentProvider;
  if (sameChat) {
    await switchModelAndRetry({
      client: input.client,
      serverId: input.serverId,
      agentId: input.agentId,
      modelId: input.modelId,
      clearRouter: input.clearRouter,
      ...(input.routerId !== undefined ? { routerId: input.routerId } : {}),
    });
    try {
      await input.persistPreference(input.provider, input.modelId);
    } catch (error) {
      console.warn("[switch-model] persist model preference failed", error);
    }
    return;
  }

  const applied = await applyProviderSwitch({
    sourceClient: input.client,
    sourceServerId: input.serverId,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    pending: {
      kind: "model",
      targetServerId: targetHost,
      provider: input.provider,
      modelId: input.modelId,
      clearRouter: input.clearRouter,
      ...(input.routerId !== undefined ? { routerId: input.routerId } : {}),
    },
    persistPreference: input.persistPreference,
    onPreferencePersistError: (error) => {
      console.warn("[switch-model] persist ported provider preference failed", error);
    },
  });

  await sendRestoredDraft({
    client: applied.client,
    agentId: applied.agentId,
    draftServerId: input.serverId,
    draftAgentId: input.agentId,
  });
  input.navigate({
    serverId: applied.serverId,
    agentId: applied.agentId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
  try {
    await applied.finalize();
  } catch (error) {
    console.warn("[switch-model] failed to archive the ported source agent", error);
  }
}

/** Sends the prompt restored into the source draft, then clears that draft. */
async function sendRestoredDraft(input: {
  client: Pick<DaemonClient, "sendAgentMessage">;
  agentId: string;
  draftServerId: string;
  draftAgentId: string;
}): Promise<void> {
  const draftKey = buildDraftStoreKey({
    serverId: input.draftServerId,
    agentId: input.draftAgentId,
  });
  const text = useDraftStore.getState().getDraftInput(draftKey)?.text;
  if (!text?.trim()) return;

  await input.client.sendAgentMessage(input.agentId, text, { messageId: generateMessageId() });
  useDraftStore.getState().clearDraftInput({ draftKey });
}
