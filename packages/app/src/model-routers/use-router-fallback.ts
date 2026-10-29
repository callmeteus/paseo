import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  isProviderCrashFailure,
  isRetryableRouterFailure,
  isSessionCorruptionFailure,
  selectFallbackTarget,
  type ModelRouterTarget,
} from "@getpaseo/protocol/model-router";
import { applyProviderSwitch } from "@/composer/agent-controls/apply-provider-switch";
import { getProviderSwitch } from "@/composer/agent-controls/pending-provider-switch";
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

interface RoutedAgent {
  id: string;
  provider: string;
  model?: string | null;
  workspaceId?: string | null;
  /** Router bound to the chat; unbound chats never fall back. */
  modelRouterId?: string | null;
}

interface PortContext {
  client: DaemonClient;
  serverId: string;
  agent: RoutedAgent;
  lastUserText: string | null;
  onNoTargets: () => void;
  onPorted: (provider: string) => void;
}

const RESEND_RETRY_DELAY_MS = 1200;
/** Crashes are local: keep retrying the same provider, never port away. */
const MAX_CRASH_RETRIES = 5;

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
 * A provider session rejected upstream (invalid tool call in its stored
 * history) can only be fixed by opening a new session on the same provider and
 * model, seeded with the ported transcript.
 */
async function repairCorruptedSession(
  input: {
    client: DaemonClient;
    serverId: string;
    agent: RoutedAgent;
    lastUserText: string | null;
  },
  onRepaired: () => void,
  onFailed: (error: unknown) => void,
): Promise<void> {
  const { client, serverId, agent, lastUserText } = input;
  try {
    const result = await client.swapAgentProvider({
      agentId: agent.id,
      targetProvider: agent.provider,
      targetModel: agent.model ?? null,
      force: true,
    });
    if (!result.newAgentId) throw new Error(result.error ?? "Session repair failed");
    if (lastUserText) await resendFailedPrompt(client, result.newAgentId, lastUserText);
    navigateToAgent({
      serverId,
      agentId: result.newAgentId,
      workspaceId: agent.workspaceId ?? undefined,
    });
    onRepaired();
  } catch (error) {
    onFailed(error);
  }
}

/** Moves the chat to the next router target and carries the prompt over. */
async function portToNextTarget(context: PortContext): Promise<void> {
  const { client, serverId, agent, lastUserText } = context;
  const boundRouterId = agent.modelRouterId?.trim();
  if (!boundRouterId) return;
  // A staged target pick wins over the watchdog: porting now would replace the
  // conversation the user is about to switch themselves.
  if (getProviderSwitch(serverId, agent.id)) return;
  const { config } = await client.getDaemonConfig();
  const settings = config.modelRouters;
  const router = settings?.routers.find((entry) => entry.id === boundRouterId);
  if (!router || router.mode !== "fallback") return;
  const next: ModelRouterTarget | null = selectFallbackTarget({
    router,
    current: { provider: agent.provider, model: agent.model ?? null },
    // The daemon resolves availability; offer every configured target.
    installedProviders: new Set(router.targets.map((target) => target.provider)),
    // Quota limits usually hit the whole account, so prefer another lab.
    skipProviders: new Set([agent.provider]),
  });
  if (!next) {
    context.onNoTargets();
    return;
  }
  const applied = await applyProviderSwitch({
    sourceClient: client,
    sourceServerId: serverId,
    agentId: agent.id,
    workspaceId: agent.workspaceId ?? null,
    pending: {
      kind: "model",
      targetServerId: serverId,
      provider: next.provider,
      modelId: next.model ?? "",
      clearRouter: true,
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
  context.onPorted(next.provider);
}

/** Reads the failed agent's error, if it is in a failed, unarchived state. */
function selectFailureError(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string | undefined,
): string | null {
  if (!agentId) return null;
  const agent = state.sessions[serverId]?.agents?.get(agentId);
  if (!agent || agent.archivedAt || agent.status !== "error" || !agent.lastError) return null;
  return agent.lastError;
}

interface RouterFailureHandlerInput {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  errorKey: string;
  notify: {
    retrying: (provider: string) => void;
    crashPersists: (provider: string) => void;
    repaired: (provider: string) => void;
    noTargets: () => void;
    ported: (provider: string) => void;
  };
  state: {
    attemptedKey: { current: string | null };
    inFlight: { current: boolean };
    crashRetries: { current: Map<string, number> };
  };
}

/** Decides between retrying in place, repairing the session, or porting away. */
function handleRouterFailure(input: RouterFailureHandlerInput): void {
  const { client, serverId, agentId, errorKey, notify, state } = input;
  const crash = isProviderCrashFailure({ error: errorKey });
  const corrupted = isSessionCorruptionFailure({ error: errorKey });
  if (!crash && !corrupted && !isRetryableRouterFailure({ error: errorKey })) return;

  const session = useSessionStore.getState().sessions[serverId];
  const liveAgent = session?.agents?.get(agentId);
  if (!liveAgent || liveAgent.archivedAt) return;
  const provider = liveAgent.provider;
  const lastUserText = selectAgentSentMessages(session, agentId)[0] ?? null;
  const agent: RoutedAgent = {
    id: agentId,
    provider,
    model: liveAgent.model ?? null,
    workspaceId: liveAgent.workspaceId ?? null,
    modelRouterId: liveAgent.modelRouterId ?? null,
  };

  if (crash) {
    const crashKey = `${serverId}:${agentId}:${errorKey}`;
    const attempts = state.crashRetries.current.get(crashKey) ?? 0;
    if (attempts >= MAX_CRASH_RETRIES) {
      notify.crashPersists(provider);
      return;
    }
    if (!lastUserText) return;
    state.crashRetries.current.set(crashKey, attempts + 1);
    notify.retrying(provider);
    void resendFailedPrompt(client, agentId, lastUserText);
    return;
  }

  if (corrupted) {
    void repairCorruptedSession(
      { client, serverId, agent, lastUserText },
      () => notify.repaired(provider),
      (error) => {
        console.warn("[RouterFallback] session repair failed", error);
      },
    );
    return;
  }

  // A ported agent can fail before the resend lands: keep walking the chain
  // even when there is no prompt left to carry over.
  const attemptKey = `${serverId}:${agentId}:${errorKey}:${lastUserText ?? ""}`;
  if (state.attemptedKey.current === attemptKey || state.inFlight.current) return;
  state.attemptedKey.current = attemptKey;
  state.inFlight.current = true;

  void portToNextTarget({
    client,
    serverId,
    agent,
    lastUserText,
    onNoTargets: notify.noTargets,
    onPorted: notify.ported,
  })
    .catch((error) => {
      console.warn("[RouterFallback] fallback failed", error);
    })
    .finally(() => {
      state.inFlight.current = false;
    });
}

/**
 * Option A fallback: when a chat fails with a retryable provider error and the
 * default router is a fallback chain, port the chat to the next target, resend
 * the failed prompt there, and move the UI to the ported agent.
 *
 * Crashes are retried on the same provider and never port; a session whose
 * history the upstream rejects is rebuilt on the same provider and model.
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
  const errorKey = useSessionStore((state) => selectFailureError(state, serverId, agentId));

  useEffect(() => {
    if (!client || !isConnected || !agentId || !errorKey) return;
    handleRouterFailure({
      client,
      serverId,
      agentId,
      errorKey,
      state: {
        attemptedKey: attemptedKeyRef,
        inFlight: inFlightRef,
        crashRetries: crashRetriesRef,
      },
      notify: {
        retrying: (provider) =>
          toast.show(t("settings.modelRouters.retryingProvider", { provider }), {
            variant: "info",
            durationMs: 3000,
          }),
        crashPersists: (provider) =>
          toast.error(t("settings.modelRouters.crashPersists", { provider })),
        repaired: (provider) =>
          toast.show(t("settings.modelRouters.sessionRepaired", { provider }), {
            variant: "info",
            durationMs: 4000,
          }),
        noTargets: () => toast.error(t("settings.modelRouters.noMoreTargets")),
        ported: (provider) =>
          toast.show(t("settings.modelRouters.fallbackMoved", { provider }), {
            variant: "info",
            durationMs: 4000,
          }),
      },
    });
  }, [agentId, client, errorKey, isConnected, serverId, t, toast]);
}
