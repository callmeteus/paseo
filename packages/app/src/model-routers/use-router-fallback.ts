import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { selectFallbackTarget, type ModelRouterTarget } from "@getpaseo/protocol/model-router";
import { applyProviderSwitch } from "@/composer/agent-controls/apply-provider-switch";
import { getProviderSwitch } from "@/composer/agent-controls/pending-provider-switch";
import {
  finishPortingActivity,
  startPortingActivity,
} from "@/composer/agent-controls/porting-activity";
import { useToast } from "@/contexts/toast-context";
import { selectAgentSentMessages, useSessionStore } from "@/stores/session-store";
import { generateMessageId } from "@/types/stream";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  decideRouterFailure,
  MAX_SESSION_REPAIRS,
  type RouterFailureAction,
} from "./router-failure-decision";

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

const RESEND_RETRY_DELAY_MS = 1200;
/** Crashes are local: keep retrying the same provider, never port away. */
const MAX_CRASH_RETRIES = 5;
/** A port creates the new agent server-side before the client can see it. */
const AGENT_ARRIVAL_TIMEOUT_MS = 5_000;
const AGENT_ARRIVAL_POLL_MS = 100;

interface PortContext {
  client: DaemonClient;
  serverId: string;
  agent: RoutedAgent;
  lastUserText: string | null;
  onNoTargets: () => void;
  onPorted: (provider: string) => void;
}

/**
 * The ported runtime can still be starting when the fallback lands, so the
 * carry-over prompt is retried once before giving up.
 */
async function resendFailedPrompt(
  client: DaemonClient,
  agentId: string,
  text: string,
): Promise<boolean> {
  const send = async () => {
    await client.sendAgentMessage(agentId, text, {
      messageId: generateMessageId(),
      activeTurnBehavior: "interrupt",
    });
  };
  try {
    await send();
    return true;
  } catch (error) {
    console.warn("[RouterFallback] failed to resend the failed prompt", error);
  }
  await new Promise((resolve) => setTimeout(resolve, RESEND_RETRY_DELAY_MS));
  try {
    await send();
    return true;
  } catch (error) {
    console.warn("[RouterFallback] failed to resend the failed prompt after a retry", error);
    return false;
  }
}

/**
 * Counts how many ports already produced this chat. A chat that has been
 * repaired twice is being rejected for a reason a fresh session cannot fix, and
 * another repair would only archive the tab the user is reading.
 */
function countPortedChain(serverId: string, agentId: string): number {
  const agents = useSessionStore.getState().sessions[serverId]?.agents;
  if (!agents) return 0;
  let length = 0;
  let current = agents.get(agentId)?.migratedFrom?.agentId;
  while (current && length < MAX_SESSION_REPAIRS + 1) {
    length += 1;
    current = agents.get(current)?.migratedFrom?.agentId;
  }
  return length;
}

/**
 * A ported agent exists on the daemon a moment before the client learns about
 * it. Navigating first resolves the workspace from a missing record, which is
 * how a repaired chat ended up on the previous tab.
 */
async function waitForAgentArrival(serverId: string, agentId: string): Promise<boolean> {
  const deadline = Date.now() + AGENT_ARRIVAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const agent = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
    if (agent) return true;
    await new Promise((resolve) => setTimeout(resolve, AGENT_ARRIVAL_POLL_MS));
  }
  return false;
}

/**
 * A provider session rejected upstream (invalid tool call in its stored
 * history) can only be fixed by opening a new session on the same provider and
 * model, seeded with the ported transcript.
 *
 * The repair runs through the same pipeline as a user-initiated switch: the
 * source chat stays open while the new session starts, the porting activity
 * keeps the ported chat out of the tab bar until the client arrives, and the
 * source is archived only after the user has been moved to the new tab.
 */
async function repairCorruptedSession(
  input: {
    client: DaemonClient;
    serverId: string;
    agent: RoutedAgent;
    lastUserText: string | null;
  },
  onRepaired: (provider: string) => void,
  onFailed: (error: unknown) => void,
): Promise<void> {
  const { client, serverId, agent, lastUserText } = input;
  startPortingActivity(serverId, agent.id, { toProvider: agent.provider });
  try {
    const applied = await applyProviderSwitch({
      sourceClient: client,
      sourceServerId: serverId,
      agentId: agent.id,
      workspaceId: agent.workspaceId ?? null,
      pending: {
        kind: "model",
        targetServerId: serverId,
        provider: agent.provider,
        modelId: agent.model ?? "",
        clearRouter: false,
        routerId: agent.modelRouterId ?? undefined,
      },
      persistPreference: async () => {},
      force: true,
    });
    await waitForAgentArrival(serverId, applied.agentId);
    if (lastUserText) await resendFailedPrompt(client, applied.agentId, lastUserText);
    navigateToAgent({
      serverId,
      agentId: applied.agentId,
      workspaceId: agent.workspaceId ?? undefined,
      pin: true,
    });
    onRepaired(agent.provider);
    void applied.finalize().catch((error: unknown) => {
      console.warn("[RouterFallback] failed to archive the repaired source agent", error);
    });
  } catch (error) {
    onFailed(error);
  } finally {
    finishPortingActivity(serverId, agent.id);
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
  await waitForAgentArrival(serverId, applied.agentId);
  if (lastUserText) await resendFailedPrompt(applied.client, applied.agentId, lastUserText);
  navigateToAgent({
    serverId: applied.serverId,
    agentId: applied.agentId,
    workspaceId: agent.workspaceId ?? undefined,
    pin: true,
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
    shrinking: (provider: string) => void;
    noTargets: () => void;
    ported: (provider: string) => void;
  };
  state: {
    attemptedKey: { current: string | null };
    inFlight: { current: boolean };
    crashRetries: { current: Map<string, number> };
    shrinkAttemptedKey: { current: string | null };
  };
}

/** A local provider crash: retry the same provider, never port away from it. */
function retryCrashedProvider(input: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  errorKey: string;
  provider: string;
  lastUserText: string | null;
  notify: RouterFailureHandlerInput["notify"];
  state: RouterFailureHandlerInput["state"];
}): void {
  const { client, serverId, agentId, errorKey, provider, lastUserText, notify, state } = input;
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
}

/** Hand the chat to the next router target. */
function startRouterPort(input: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  errorKey: string;
  agent: RoutedAgent;
  lastUserText: string | null;
  notify: RouterFailureHandlerInput["notify"];
  state: RouterFailureHandlerInput["state"];
}): void {
  const { client, serverId, agentId, errorKey, agent, lastUserText, notify, state } = input;
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

/** Decides between retrying in place, repairing the session, or porting away. */
function handleRouterFailure(input: RouterFailureHandlerInput): void {
  const { client, serverId, agentId, errorKey, notify, state } = input;
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

  const action: RouterFailureAction = decideRouterFailure({
    errorKey,
    repairChainLength: countPortedChain(serverId, agentId),
    alreadyShrunkTools: state.shrinkAttemptedKey.current === `${agentId}:${errorKey}`,
    hasRouterTarget: Boolean(agent.modelRouterId?.trim()),
  });

  switch (action.kind) {
    case "retry-same":
      retryCrashedProvider({
        client,
        serverId,
        agentId,
        errorKey,
        provider,
        lastUserText,
        notify,
        state,
      });
      return;

    case "repair-session":
      void repairCorruptedSession(
        { client, serverId, agent, lastUserText },
        () => notify.repaired(provider),
        (error) => {
          console.warn("[RouterFallback] session repair failed", error);
        },
      );
      return;

    case "shrink-tools":
      // The daemon learned the model's ceiling from the failure it just
      // recorded, so the next request is pruned to fit. One retry is enough:
      // a second rejection means the ceiling cannot be met at all.
      state.shrinkAttemptedKey.current = `${agentId}:${errorKey}`;
      if (!lastUserText) return;
      notify.shrinking(provider);
      void resendFailedPrompt(client, agentId, lastUserText);
      return;

    case "port":
      startRouterPort({
        client,
        serverId,
        agentId,
        errorKey,
        agent,
        lastUserText,
        notify,
        state,
      });
      return;

    case "surface":
      // Nothing left to try that could change the outcome. The chat keeps its
      // error card, which is the honest place for the failure.
      return;
  }
}

/**
 * Option A fallback: when a chat fails with a retryable provider error and the
 * default router is a fallback chain, port the chat to the next target, resend
 * the failed prompt there, and move the UI to the ported agent.
 *
 * Crashes are retried on the same provider and never port. A session whose
 * history the upstream rejects is rebuilt on the same provider and model, at
 * most {@link MAX_SESSION_REPAIRS} times. A request rejected for carrying too
 * many tools is retried once against the ceiling the daemon just learned.
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
  const shrinkAttemptedKeyRef = useRef<string | null>(null);
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
        shrinkAttemptedKey: shrinkAttemptedKeyRef,
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
        shrinking: (provider) =>
          toast.show(t("settings.modelRouters.shrinkingTools", { provider }), {
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
