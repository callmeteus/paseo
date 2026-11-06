import { useEffect } from "react";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { generateMessageId } from "@/types/stream";
import { limitResumeAction } from "./limit-resume";
import { useLimitResumeStore } from "./limit-resume-store";

const RETRY_DELAY_MS = 15_000;

/** Chats already waiting on a retry, so a second timer does not send twice. */
const pendingRetry = new Set<string>();
/** Chats whose continuation is in flight. */
const claimed = new Set<string>();

/**
 * Sends the continuation for chats on this host when their limit ends.
 * The timer lives here, not in the alert, so leaving the chat does not cancel it.
 */
export function useLimitResumeRunner(serverId: string): void {
  const byAgentId = useLimitResumeStore((state) => state.byAgentId);
  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const [agentId, entry] of Object.entries(byAgentId)) {
      if (entry.serverId !== serverId) continue;
      const delay = Math.max(0, entry.resetAt - Date.now());
      timers.push(setTimeout(() => resumeLimit(serverId, agentId), delay));
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [byAgentId, serverId]);
}

function resumeLimit(serverId: string, agentId: string): void {
  const store = useLimitResumeStore.getState();
  const entry = store.byAgentId[agentId];
  if (!entry || entry.serverId !== serverId) return;

  const session = useSessionStore.getState().sessions[serverId];
  const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
  const action = limitResumeAction({
    routerId: agent?.modelRouterId,
    resetAt: entry.resetAt,
    now: Date.now(),
  });
  if (action === "drop") {
    store.disarm(agentId);
    return;
  }
  if (action === "wait") return;

  const client = getHostRuntimeStore().getClient(serverId);
  if (!client || agent?.turn?.phase === "open") {
    scheduleRetry(serverId, agentId);
    return;
  }
  if (claimed.has(agentId)) return;
  claimed.add(agentId);
  store.disarm(agentId);
  void client
    .sendAgentMessage(agentId, i18n.t("agentStream.sessionLimit.resumePrompt"), {
      messageId: generateMessageId(),
    })
    .catch((error: unknown) => {
      console.warn("[LimitResume] failed to continue the chat", error);
    })
    .finally(() => {
      claimed.delete(agentId);
    });
}

function scheduleRetry(serverId: string, agentId: string): void {
  if (pendingRetry.has(agentId)) return;
  pendingRetry.add(agentId);
  setTimeout(() => {
    pendingRetry.delete(agentId);
    resumeLimit(serverId, agentId);
  }, RETRY_DELAY_MS);
}
