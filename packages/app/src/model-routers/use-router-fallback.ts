import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  isRetryableRouterFailure,
  selectFallbackTarget,
  type ModelRouterTarget,
} from "@getpaseo/protocol/model-router";
import { applyProviderSwitch } from "@/composer/agent-controls/apply-provider-switch";
import { useToast } from "@/contexts/toast-context";
import { selectAgentSentMessages, useSessionStore } from "@/stores/session-store";
import { generateMessageId } from "@/types/stream";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

interface UseRouterFallbackInput {
  serverId: string;
  agentId: string | undefined;
  client: DaemonClient | null;
  isConnected: boolean;
}

/**
 * Option A fallback: when a chat fails with a retryable provider error and the
 * default router is a fallback chain, port the chat to the next target, resend
 * the failed prompt there, and move the UI to the ported agent.
 */
export function useRouterFallback({
  serverId,
  agentId,
  client,
  isConnected,
}: UseRouterFallbackInput): void {
  const { t } = useTranslation();
  const toast = useToast();
  const attemptedKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const errorKey = useSessionStore((state) => {
    if (!agentId) return null;
    const agent = state.sessions[serverId]?.agents?.get(agentId);
    if (!agent || agent.archivedAt || agent.status !== "error" || !agent.lastError) return null;
    return agent.lastError;
  });

  useEffect(() => {
    if (!client || !isConnected || !agentId || !errorKey) return;
    if (!isRetryableRouterFailure({ error: errorKey })) return;
    const state = useSessionStore.getState();
    const session = state.sessions[serverId];
    const agent = session?.agents?.get(agentId);
    if (!agent || agent.archivedAt) return;
    const lastUserText = selectAgentSentMessages(session, agentId)[0] ?? null;
    if (!lastUserText) return;
    const attemptKey = `${serverId}:${agentId}:${agent.lastError}:${lastUserText}`;
    if (attemptedKeyRef.current === attemptKey || inFlightRef.current) return;
    attemptedKeyRef.current = attemptKey;
    inFlightRef.current = true;

    void (async () => {
      let next: ModelRouterTarget | null = null;
      try {
        const { config } = await client.getDaemonConfig();
        const settings = config.modelRouters;
        const router = settings?.defaultRouterId
          ? settings.routers.find((entry) => entry.id === settings.defaultRouterId)
          : undefined;
        if (!router || router.mode !== "fallback") return;
        next = selectFallbackTarget({
          router,
          current: { provider: agent.provider, model: agent.model ?? null },
          // The daemon resolves availability; offer every configured target.
          installedProviders: new Set(router.targets.map((target) => target.provider)),
        });
        if (!next) {
          toast.error(t("settings.modelRouters.noMoreTargets"));
          return;
        }
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
        await applied.client.sendAgentMessage(applied.agentId, lastUserText, {
          messageId: generateMessageId(),
          activeTurnBehavior: "interrupt",
        });
        navigateToAgent({
          serverId: applied.serverId,
          agentId: applied.agentId,
          workspaceId: agent.workspaceId ?? undefined,
        });
        void applied.finalize().catch((error: unknown) => {
          console.warn("[RouterFallback] failed to archive the ported source agent", error);
        });
        toast.show(t("settings.modelRouters.fallbackMoved", { provider: next.provider }), {
          variant: "info",
          durationMs: 4000,
        });
      } catch (error) {
        console.warn("[RouterFallback] fallback failed", error);
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [agentId, client, errorKey, isConnected, serverId, t, toast]);
}
