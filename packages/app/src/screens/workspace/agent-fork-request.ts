import { useSyncExternalStore } from "react";
import type { AssistantForkTarget } from "@/components/assistant-fork-menu";

/**
 * A chat-tab menu asking to fork that chat. Kept outside React so the menu,
 * deep in the tab row, can ask without a callback through every tab.
 */
export interface AgentForkRequest {
  agentId: string;
  target: AssistantForkTarget;
  nonce: number;
}

let request: AgentForkRequest | null = null;
let nextNonce = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function requestAgentFork(agentId: string, target: AssistantForkTarget): void {
  nextNonce += 1;
  request = { agentId, target, nonce: nextNonce };
  emit();
}

export function clearAgentForkRequest(): void {
  if (request === null) return;
  request = null;
  emit();
}

/** One mounted workspace claims the request. A second host in the same commit gets null. */
export function claimAgentForkRequest(claimedNonce: number): AgentForkRequest | null {
  if (!request || request.nonce !== claimedNonce) return null;
  const claimed = request;
  request = null;
  emit();
  return claimed;
}

export function getAgentForkRequest(): AgentForkRequest | null {
  return request;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgentForkRequest(): AgentForkRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
}
