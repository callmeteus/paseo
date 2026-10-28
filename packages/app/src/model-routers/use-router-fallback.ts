import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  isProviderCrashFailure,
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

const RESEND_RETRY_DELAY_MS = 1200;
/** Crashes are local: retry twice on the same provider before porting away. */
const MAX_CRASH_RETRIES = 2;

/**
 * The ported runtime can still be starting when the fallback lands, so the
 * carry-over prompt is retried once before giving up.
 */
async function resendFailedPrompt(
  client: DaemonClient,
  agentId: string,
  text: string,
): Promise<void> {
  const send = () =>
    client.sendAgentMessage(agentId, text, {
      messageId: generateMessageId(),
      activeTurnBehavior: "interrupt",
    });
  try {
    await send();
    return;
  } catch (error) {
    console.warn("[RouterFallback] failed to resend the failed prompt", error);
  }
  await new Promise((resolve) => setTimeout(resolve, RESEND_RETRY_DELAY_MS));
  try {
    await send();
  } catch (error) {
    console.warn("[RouterFallback] failed to resend the failed prompt after a retry", error);
  }
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
  const crashRetriesRef = useRef(new Map<string, number>());
  const errorKey = useSessionStore((state) => {
    if (!agentId) return null;
    const agent = state.sessions[serverId]?.agents?.get(agentId);
    if (!agent || agent.archivedAt || agent.status !== "error" || !agent.lastError) return null;
    return agent.lastError;
  });

  useEffect(() => {
    if (!client || !isConnected || !agentId || !errorKey) return;
    const crash = isProviderCrashFailure({ error: errorKey });
    if (!crash && !isRetryableRouterFailure({ error: errorKey })) return;
    const state = useSessionStore.getState();
    const session = state.sessions[serverId];
    const agent = session?.agents?.get(agentId);
    if (!agent || agent.archivedAt) return;
    const lastUserText = selectAgentSentMessages(session, agentId)[0] ?? null;

    // A crashed provider helper is not a quota problem: retry the same agent
    // instead of porting the chat to another provider.
    if (crash && lastUserText) {
      const crashKey = `${serverId}:${agentId}:${errorKey}`;
      const attempts = crashRetriesRef.current.get(crashKey) ?? 0;
      if (attempts < MAX_CRASH_RETRIES) {
        crashRetriesRef.current.set(crashKey, attempts + 1);
        toast.show(t("settings.modelRouters.retryingProvider", { provider: agent.provider }), {
          variant: "info",
          durationMs: 3000,
        });
        void resendFailedPrompt(client, agentId, lastUserText);
        return;
      }
    }

    // A ported agent can fail before the resend lands: keep walking the chain
    // even when there is no prompt left to carry over.
    const attemptKey = `${serverId}:${agentId}:${agent.lastError}:${lastUserText ?? ""}`;
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
          // Quota limits usually hit the whole account, so prefer another lab.
          skipProviders: new Set([agent.provider]),
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
        if (lastUserText) await resendFailedPrompt(applied.client, applied.agentId, lastUserText);
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
