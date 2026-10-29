import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { performCrossHostPort } from "./cross-host-port";
import { performAgentProviderSwap } from "./provider-swap";
import type { StagedModelTarget } from "./pending-provider-switch";

/**
 * Router binding carried by a staged model switch: an explicit pick wins, then
 * a detach, otherwise the port keeps the server default.
 */
function resolveRouterBinding(pending: StagedModelTarget): { modelRouterId?: string | null } {
  if (pending.routerId !== undefined) {
    return { modelRouterId: pending.routerId };
  }
  if (pending.clearRouter) {
    return { modelRouterId: null };
  }
  return {};
}

export interface ApplyProviderSwitchInput {
  sourceClient: DaemonClient;
  sourceServerId: string;
  agentId: string;
  workspaceId: string | null;
  pending: StagedModelTarget;
  persistPreference: (provider: string, modelId: string) => Promise<unknown>;
  onPreferencePersistError?: (error: unknown) => void;
}

export interface ApplyProviderSwitchResult {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  /**
   * Archives the source agent. Called after the client has navigated to the new
   * chat, so the old conversation stays on screen while the port runs.
   */
  finalize: () => Promise<void>;
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
      ...resolveRouterBinding(input.pending),
      archivePrevious: false,
      persistPreference: input.persistPreference,
      onPreferencePersistError: input.onPreferencePersistError,
    });
    return {
      client: input.sourceClient,
      serverId: input.sourceServerId,
      agentId: result.newAgentId,
      finalize: async () => {
        if (!result.previousAgentId) return;
        await input.sourceClient.archiveAgent(result.previousAgentId, {
          migratedTo: {
            provider: input.pending.provider,
            agentId: result.newAgentId,
            host: input.sourceServerId,
            portedAt: new Date().toISOString(),
          },
        });
      },
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
    archiveSource: false,
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
    finalize: async () => {
      await input.sourceClient.archiveAgent(input.agentId, {
        migratedTo: {
          provider: input.pending.provider,
          agentId: result.newAgentId,
          host: targetHost,
          portedAt: new Date().toISOString(),
        },
      });
    },
  };
}
