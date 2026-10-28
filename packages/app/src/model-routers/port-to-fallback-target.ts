import { selectFallbackTarget } from "@getpaseo/protocol/model-router";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { applyProviderSwitch } from "@/composer/agent-controls/apply-provider-switch";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useSessionStore } from "@/stores/session-store";

export type PortToFallbackResult =
  | { outcome: "ported"; provider: string }
  | { outcome: "no-target" }
  | { outcome: "not-fallback" }
  | { outcome: "unknown-router" }
  | { outcome: "failed"; reason: string };

/**
 * Ports an existing chat to the first target of a fallback router, following
 * the same provider-switch port flow the error watchdog uses.
 */
export async function portAgentToFallbackRouter(input: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  routerId: string;
}): Promise<PortToFallbackResult> {
  const { client, serverId, agentId, routerId } = input;
  try {
    const { config } = await client.getDaemonConfig();
    const router = config.modelRouters?.routers.find((entry) => entry.id === routerId);
    if (!router) return { outcome: "unknown-router" };
    if (router.mode !== "fallback") return { outcome: "not-fallback" };
    const next =
      selectFallbackTarget({
        router,
        current: null,
        installedProviders: new Set(router.targets.map((target) => target.provider)),
      }) ?? null;
    if (!next) return { outcome: "no-target" };
    const session = useSessionStore.getState().sessions[serverId];
    const agent = session?.agents?.get(agentId);
    if (!agent) return { outcome: "unknown-router" };
    const applied = await applyProviderSwitch({
      sourceClient: client,
      sourceServerId: serverId,
      agentId,
      workspaceId: agent.workspaceId ?? null,
      pending: {
        targetServerId: serverId,
        provider: next.provider,
        modelId: next.model ?? "",
      },
      persistPreference: async () => {},
    });
    navigateToAgent({
      serverId: applied.serverId,
      agentId: applied.agentId,
      workspaceId: agent.workspaceId ?? undefined,
    });
    void applied.finalize().catch((error: unknown) => {
      console.warn("[RouterPort] failed to archive the ported source agent", error);
    });
    return { outcome: "ported", provider: next.provider };
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
