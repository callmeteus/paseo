import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { performCrossHostPort } from "./cross-host-port";
import { performAgentProviderSwap } from "./provider-swap";
import type { PendingProviderSwitch } from "./pending-provider-switch";

export interface ApplyProviderSwitchInput {
  sourceClient: DaemonClient;
  sourceServerId: string;
  agentId: string;
  workspaceId: string | null;
  pending: PendingProviderSwitch;
  persistPreference: (provider: string, modelId: string) => Promise<unknown>;
  onPreferencePersistError?: (error: unknown) => void;
}

export interface ApplyProviderSwitchResult {
  client: DaemonClient;
  serverId: string;
  agentId: string;
}

/**
 * Commits a staged provider switch. Same-host swaps go through the daemon's
 * provider-swap RPC; cross-host switches export the snapshot to the destination
 * and archive the source. The returned client/server pair is where the message
 * that triggered the switch must be sent.
 */
export async function applyProviderSwitch(
  input: ApplyProviderSwitchInput,
): Promise<ApplyProviderSwitchResult> {
  const targetHost = input.pending.targetServerId.trim() || input.sourceServerId;

  if (targetHost === input.sourceServerId) {
    const result = await performAgentProviderSwap({
      client: input.sourceClient,
      agentId: input.agentId,
      provider: input.pending.provider,
      modelId: input.pending.modelId,
      persistPreference: input.persistPreference,
      onPreferencePersistError: input.onPreferencePersistError,
    });
    return {
      client: input.sourceClient,
      serverId: input.sourceServerId,
      agentId: result.newAgentId,
    };
  }

  const destinationClient = getHostRuntimeStore().getClient(targetHost);
  if (!destinationClient) {
    throw new Error("Target host is not connected");
  }
  const result = await performCrossHostPort({
    sourceClient: input.sourceClient,
    destinationClient,
    agentId: input.agentId,
    provider: input.pending.provider,
    modelId: input.pending.modelId,
    agentWorkspaceId: input.workspaceId,
    sourceHost: input.sourceServerId,
    targetHost,
  });
  try {
    await input.persistPreference(input.pending.provider, input.pending.modelId);
  } catch (error) {
    input.onPreferencePersistError?.(error);
  }
  return {
    client: destinationClient,
    serverId: targetHost,
    agentId: result.newAgentId,
  };
}
